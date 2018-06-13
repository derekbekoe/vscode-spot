import { ResourceManagementClient, ResourceModels } from 'azure-arm-resource';
import * as dns from 'dns';
import * as request from 'request-promise';
import * as util from 'util';

import { MessageItem, window, workspace } from 'vscode';

import { AzureSubscription } from './azure-account.api';
import { randomBytes } from './ipc';
import { certbotContainer, deploymentTemplateBase, userContainer } from './spotDeploy';
import { getSpotSetupConfig, SpotSetupConfig } from './spotSetup';
import { HealthCheckError, spotHealthCheck, UserCancelledError } from './spotUtil';

// tslint:disable-next-line:no-var-requires
require('util.promisify').shim();

const DEFAULT_SPOT_REGION = 'westus';
const DEFAULT_SPOT_FILE_WATCHER_PATH = '/root';
const DEPLOYMENT_NAME_PREFIX = 'spot-deployment';
const SPOT_SSL_PORT = '443';
const SPOT_NOSSL_PORT = '80';

// tslint:disable:max-classes-per-file

function getDeploymentName() {
    const date = new Date();
    const dateDay = date.getUTCDate();
    const dateMonth = date.getUTCMonth();
    const dateYr = date.getUTCFullYear();
    const dateHr = date.getUTCHours();
    const dateMin = date.getUTCMinutes();
    const dateSec = date.getUTCSeconds();
    // tslint:disable-next-line:max-line-length
    const deploymentName: string = `${DEPLOYMENT_NAME_PREFIX}-${dateDay}-${dateMonth}-${dateYr}-${dateHr}-${dateMin}-${dateSec}`;
    return deploymentName;
}

export interface IDeploymentTemplateConfig {
    deploymentTemplate: object;
    hostname: string;
    instanceToken: string;
    useSSL: boolean;
    spotRegion: string;
}

export interface ISpotCreationData {
    useSSL: boolean;
    spotName: string;
    imageName: string;
    spotRegion: string;
    hostname: string;
    instanceToken: string;
}

export class SpotDeploymentError extends Error {
    constructor(public message: string, public spotCreationData: ISpotCreationData) {
        super(message);
    }
}

export class CreationHealthCheckError extends HealthCheckError {
    constructor(public message: string, public spotCreationData: ISpotCreationData) {
        super(message);
    }
}

export async function configureDeploymentTemplate(
    spotName: string,
    imageName: string,
    spotRegion: string,
    azureSub: AzureSubscription,
    spotConfig: SpotSetupConfig): Promise<IDeploymentTemplateConfig> {
    const buffer: Buffer = await randomBytes(256);
    const instanceToken = buffer.toString('hex');

    const deploymentTemplate = JSON.parse(JSON.stringify(deploymentTemplateBase));
    deploymentTemplate.variables.spotName = `${spotName}`;
    deploymentTemplate.variables.container1image = imageName;
    deploymentTemplate.variables.instanceToken = instanceToken;
    deploymentTemplate.variables.certbotEmail = azureSub.session.userId;
    deploymentTemplate.variables.location = spotRegion;

    deploymentTemplate.variables.azureFileShareName1 = spotConfig.azureFileShareName1;
    deploymentTemplate.variables.azureFileShareName2 = spotConfig.azureFileShareName2;
    deploymentTemplate.variables.azureStorageAccountName1 = spotConfig.azureStorageAccountName;
    deploymentTemplate.variables.azureStorageAccountKey1 = spotConfig.azureStorageAccountKey;
    deploymentTemplate.variables.azureStorageAccountName2 = spotConfig.azureStorageAccountName;
    deploymentTemplate.variables.azureStorageAccountKey2 = spotConfig.azureStorageAccountKey;
    // tslint:disable-next-line:max-line-length
    deploymentTemplate.variables.fileWatcherWatchPath = workspace.getConfiguration('spot').get('fileWatcherWatchPath') || DEFAULT_SPOT_FILE_WATCHER_PATH;
    const useSSL = workspace.getConfiguration('spot').get('createSpotWithSSLEnabled', false);
    // tslint:disable-next-line:max-line-length
    const hostname: string = useSSL ? `https://${spotName}.${spotRegion}.azurecontainer.io:${SPOT_SSL_PORT}` : `http://${spotName}.${spotRegion}.azurecontainer.io:${SPOT_NOSSL_PORT}`;
    if (useSSL) {
        console.log('Spot will be created with SSL enabled.');
        deploymentTemplate.variables.useSSL = '1';
        deploymentTemplate.variables.container1port = SPOT_SSL_PORT;
        deploymentTemplate.resources[0].properties.containers = [userContainer, certbotContainer];
    } else {
        console.log('Spot will be created with SSL disabled.');
        deploymentTemplate.variables.useSSL = '0';
        deploymentTemplate.variables.container1port = SPOT_NOSSL_PORT;
        deploymentTemplate.resources[0].properties.containers = [userContainer];
    }
    return {deploymentTemplate: deploymentTemplate,
            hostname: hostname,
            instanceToken: instanceToken,
            useSSL: useSSL,
            spotRegion: spotRegion};
}

function validateSpotName(val: string) {
    /* Do client-side validation on the name since ACI will reject it at deploy time anyway.
       The current error from ACI is something like this so we check these client-side:
       "It can contain only lowercase letters, numbers and hyphens.
       The first character must be a letter. The last character must be a letter or number.
       The value must be between 5 and 63 characters long." */
    if (val.length < 5 || val.length > 63) {
        return 'Length of name must be between 5 and 63 characters long';
    }
    if (val.match(/[^a-z\d\-]/g)) {
        return 'Name can contain only lowercase letters, numbers and hyphens';
    }
    if (val !== val.toLowerCase()) {
        return 'Upper case characters not allowed';
    }
    if (!val.charAt(0).match(/[a-z]/i)) {
        return 'The first character must be a letter';
    }
    if (!val.charAt(val.length - 1).match(/[a-z\d]/i)) {
        return 'The last character must be a letter or number';
    }
    return null;
}

export async function spotCreate(azureSub: AzureSubscription): Promise<ISpotCreationData> {
    // Get the region at the beginning since we need to to validate the spot name DNS label.
    const spotRegion: string = workspace.getConfiguration('spot').get('azureRegion') || DEFAULT_SPOT_REGION;
    let spotName: string | undefined;
    let imageName: string | undefined;
    let spotDNSLabelOk: boolean = false;
    let spotImageNameOk: boolean = false;
    do {
        spotName = await window.showInputBox(
                {placeHolder: 'Name of spot.',
                ignoreFocusOut: true,
                validateInput: validateSpotName
            });
        if (!spotName) {
            throw new UserCancelledError('No spot name specified. Operation cancelled.');
        }
        try {
            const fullHostname = `${spotName}.${spotRegion}.azurecontainer.io`;
            console.log(`Resolving DNS for ${fullHostname} to check if exists already.`);
            await util.promisify(dns.resolve)(fullHostname);
            console.log('Spot DNS label check', `${fullHostname} appears taken. Try another.`);
            // tslint:disable-next-line:max-line-length
            window.showWarningMessage(`Spot name ${spotName} in region ${spotRegion} is taken. Please enter a different name or try again later.`, {modal: true});
        } catch (err) {
            console.log('Spot DNS label check OK', err.message);
            // DNS label available or failed to check so continue optimistically.
            spotDNSLabelOk = true;
        }
    } while (!spotDNSLabelOk);
    do {
        imageName = await window.showInputBox({
            placeHolder: 'Container image name (e.g. ubuntu:xenial)',
            ignoreFocusOut: true});
        if (!imageName) {
            throw new UserCancelledError('No container image name specified. Operation cancelled.');
        }
        let dockerhubRepo: string;
        let dockerhubTag: string;
        const posOfColon: number = imageName.indexOf(':');
        if (posOfColon === -1) {
            dockerhubRepo = imageName;
            dockerhubTag = 'latest';
        } else {
            dockerhubRepo = imageName.substring(0, posOfColon);
            dockerhubTag = imageName.substring(posOfColon + 1);
        }
        // tslint:disable-next-line:max-line-length
        const reqUri: string = `https://index.docker.io/v1/repositories/${dockerhubRepo}/tags/${dockerhubTag}`;
        console.log(`Making request to ${reqUri}`);
        const response = await request({uri: reqUri, method: 'GET', simple: false, resolveWithFullResponse: true});
        console.log(`Got ${response.statusCode} from ${reqUri}`, response);
        if (response.statusCode === 404) {
            // tslint:disable-next-line:max-line-length
            window.showWarningMessage(`The image ${imageName} is not available on Docker Hub. Please enter a different image name.`, {modal: true});
        } else {
            // If there is another other error other than a clear 404, be optimistic and continue.
            spotImageNameOk = true;
        }
    } while (!spotImageNameOk);
    const spotConfig: SpotSetupConfig = await getSpotSetupConfig(azureSub);
    const deploymentName: string = getDeploymentName();
    const deploymentConfig: IDeploymentTemplateConfig = await configureDeploymentTemplate(spotName,
                                                                                          imageName,
                                                                                          spotRegion,
                                                                                          azureSub,
                                                                                          spotConfig);
    const deploymentOptions: ResourceModels.Deployment = {
        properties: { mode: 'Incremental', template: deploymentConfig.deploymentTemplate}
    };
    const confirmYesMsgItem = {title: 'Yes'};
    const confirmNoMsgItem = {title: 'No'};
    const confimMsgResponse: MessageItem | undefined = await window.showWarningMessage(
        `Are you sure you want to create the spot ${spotName}`,
        confirmYesMsgItem, confirmNoMsgItem);
    if (confimMsgResponse !== confirmYesMsgItem) {
        throw new UserCancelledError('User cancelled spot create operation.');
    }
    console.log('Deployment template for spot creation', deploymentConfig.deploymentTemplate);
    window.showInformationMessage(`Creating spot ${spotName}`);
    const rmClient = new ResourceManagementClient(azureSub.session.credentials,
                                                    azureSub.subscription.subscriptionId!);
    const spotCreationData: ISpotCreationData = {useSSL: deploymentConfig.useSSL,
        spotName: spotName,
        imageName: imageName,
        spotRegion: deploymentConfig.spotRegion,
        hostname: deploymentConfig.hostname,
        instanceToken: deploymentConfig.instanceToken};
    try {
        const deploymentResult: ResourceModels.DeploymentExtended = await rmClient.deployments.createOrUpdate(
                                            spotConfig.resourceGroupName,
                                            deploymentName,
                                            deploymentOptions);
        console.log('Deployment provisioningState', deploymentResult.properties!.provisioningState);
        console.log('Deployment correlationId', deploymentResult.properties!.correlationId);
        console.log('Deployment completed');
    } catch (err) {
        throw new SpotDeploymentError(err, spotCreationData);
    }
    try {
        window.showInformationMessage('Running health check for spot');
        await spotHealthCheck(deploymentConfig.hostname, deploymentConfig.instanceToken);
    } catch (err) {
        throw new CreationHealthCheckError(err, spotCreationData);
    }
    return spotCreationData;
}
