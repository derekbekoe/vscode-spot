import { window, MessageItem, workspace } from 'vscode';
import { getSpotSetupConfig, SpotSetupConfig } from './spotSetup';
import { AzureSubscription } from './azure-account.api';
import { randomBytes } from './ipc';
import { deploymentTemplateBase, certbotContainer, userContainer } from './spotDeploy';
import { spotHealthCheck, UserCancelledError, HealthCheckError } from './spotUtil';
import { ResourceManagementClient, ResourceModels } from 'azure-arm-resource';

const DEFAULT_SPOT_REGION = 'westus';
const DEFAULT_SPOT_FILE_WATCHER_PATH = '/root';
const DEPLOYMENT_NAME_PREFIX = 'spot-deployment';
const SPOT_SSL_PORT = '443';
const SPOT_NOSSL_PORT = '80';

function getDeploymentName() {
    const date = new Date();
    const dateDay = date.getUTCDate();
    const dateMonth = date.getUTCMonth();
    const dateYr = date.getUTCFullYear();
    const dateHr = date.getUTCHours();
    const dateMin = date.getUTCMinutes();
    const dateSec = date.getUTCSeconds();
    const deploymentName: string = `${DEPLOYMENT_NAME_PREFIX}-${dateDay}-${dateMonth}-${dateYr}-${dateHr}-${dateMin}-${dateSec}`;
    return deploymentName;
}

export interface DeploymentTemplateConfig {
    deploymentTemplate: object,
    hostname: string,
    instanceToken: string,
    useSSL: boolean,
    spotRegion: string
}

export interface ISpotCreationData {
    useSSL: boolean,
    spotName: string,
    imageName: string,
    spotRegion: string,
    hostname: string,
    instanceToken: string
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
    azureSub: AzureSubscription,
    spotConfig: SpotSetupConfig): Promise<DeploymentTemplateConfig> {
    const buffer: Buffer = await randomBytes(256);
    const instanceToken = buffer.toString('hex');
    
    const spotRegion: string = workspace.getConfiguration('spot').get('azureRegion') || DEFAULT_SPOT_REGION;
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
    deploymentTemplate.variables.fileWatcherWatchPath = workspace.getConfiguration('spot').get('fileWatcherWatchPath') || DEFAULT_SPOT_FILE_WATCHER_PATH;
    const useSSL = workspace.getConfiguration('spot').get('createSpotWithSSLEnabled', false);
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
    return !val.includes(' ') ? null : 'Name cannot contain spaces';
}

export async function createSpot(azureSub: AzureSubscription): Promise<ISpotCreationData> {
    const spotName: string | undefined = await window.showInputBox(
            {placeHolder: 'Name of spot.',
            ignoreFocusOut: true,
            validateInput: validateSpotName
        });
    if (!spotName) {
        throw new UserCancelledError('No spot name specified. Operation cancelled.');
    }
    const imageName : string | undefined = await window.showInputBox({
        placeHolder: 'Container image name (e.g. ubuntu:xenial)',
        ignoreFocusOut: true});
    if (!imageName) {
        throw new UserCancelledError('No container image name specified. Operation cancelled.');
    }
    const spotConfig: SpotSetupConfig = await getSpotSetupConfig(azureSub);
    const deploymentName: string = getDeploymentName();
    const deploymentConfig: DeploymentTemplateConfig = await configureDeploymentTemplate(spotName, imageName, azureSub, spotConfig);
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
    window.showInformationMessage(`Running health check for ${spotName}`);
    try {
        await spotHealthCheck(deploymentConfig.hostname, deploymentConfig.instanceToken);
    } catch(err) {
        throw new CreationHealthCheckError(err, spotCreationData); 
    }
    return spotCreationData;
}
