import { ContainerRegistryManagementClient, ContainerRegistryManagementModels } from 'azure-arm-containerregistry';
import { ResourceManagementClient, ResourceModels } from 'azure-arm-resource';

import * as dns from 'dns';
import opn = require('opn');
import * as request from 'request-promise';
import * as util from 'util';

import { MessageItem, window, workspace } from 'vscode';

import { AzureSubscription } from './azure-account.api';
import { randomBytes } from './ipc';
import { Logging } from './logging';
import { certbotContainer, deploymentTemplateBase, userContainer } from './spotDeploy';
import { getSpotAcrSetupConfig, getSpotSetupConfig, IAcrSetupConfig, SpotSetupConfig } from './spotSetup';
import { delay, HealthCheckError, spotHealthCheck, UserCancelledError } from './spotUtil';

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

export interface ISpotAcrCreds {
    server: string;
    username: string;
    password: string;
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
    spotConfig: SpotSetupConfig,
    acrCreds?: ISpotAcrCreds): Promise<IDeploymentTemplateConfig> {
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
        Logging.log('Spot will be created with SSL enabled.');
        deploymentTemplate.variables.useSSL = '1';
        deploymentTemplate.variables.container1port = SPOT_SSL_PORT;
        deploymentTemplate.resources[0].properties.containers = [userContainer, certbotContainer];
    } else {
        Logging.log('Spot will be created with SSL disabled.');
        deploymentTemplate.variables.useSSL = '0';
        deploymentTemplate.variables.container1port = SPOT_NOSSL_PORT;
        deploymentTemplate.resources[0].properties.containers = [userContainer];
    }
    if (acrCreds) {
        deploymentTemplate.resources[0].properties.imageRegistryCredentials = [{
            server: acrCreds.server,
            username: acrCreds.username,
            password: acrCreds.password
        }];
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

async function getSpotNameFromUser(spotRegion: string): Promise<string> {
    let spotName: string | undefined;
    let spotDNSLabelOk: boolean = false;
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
            Logging.log(`Resolving DNS for ${fullHostname} to check if exists already.`);
            await util.promisify(dns.resolve)(fullHostname);
            Logging.log('Spot DNS label check', `${fullHostname} appears taken. Try another.`);
            // tslint:disable-next-line:max-line-length
            window.showWarningMessage(`Spot name ${spotName} in region ${spotRegion} is taken. Please enter a different name or try again later.`, {modal: true});
        } catch (err) {
            Logging.log('Spot DNS label check OK', err.message);
            // DNS label available or failed to check so continue optimistically.
            spotDNSLabelOk = true;
        }
    } while (!spotDNSLabelOk);
    return spotName;
}

export async function spotCreate(azureSub: AzureSubscription): Promise<ISpotCreationData> {
    const spotRegion: string = workspace.getConfiguration('spot').get('azureRegion') || DEFAULT_SPOT_REGION;
    let imageName: string | undefined;
    let spotImageNameOk: boolean = false;
    let acrCreds: ISpotAcrCreds | undefined;
    const spotName = await getSpotNameFromUser(spotRegion);
    do {
        imageName = await window.showInputBox({
            placeHolder: 'Container image name (e.g. ubuntu:xenial or myreg.azurecr.io/webapp:1)',
            ignoreFocusOut: true});
        if (!imageName) {
            throw new UserCancelledError('No container image name specified. Operation cancelled.');
        }
        if (imageName.indexOf('azurecr.io') > -1) {
            // This is an ACR image (we do no validation to check it is valid)
            spotImageNameOk = true;
            const acrUser = await window.showInputBox(
                {placeHolder: 'Registry username.',
                ignoreFocusOut: true
            });
            const acrPass = await window.showInputBox(
                {placeHolder: 'Registry password.',
                ignoreFocusOut: true,
                password: true
            });
            if (acrUser && acrPass) {
                acrCreds = {
                    server: imageName.substring(0, imageName.indexOf('/')),
                    username: acrUser,
                    password: acrPass
                };
            }
        } else {
            // Assume DockerHub
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
            Logging.log(`Making request to ${reqUri}`);
            const response = await request({uri: reqUri, method: 'GET', simple: false, resolveWithFullResponse: true});
            Logging.log(`Got ${response.statusCode} from ${reqUri}`, response);
            if (response.statusCode === 404) {
                // tslint:disable-next-line:max-line-length
                window.showWarningMessage(`The image ${imageName} is not available on Docker Hub. Please enter a different image name.`, {modal: true});
            } else {
                // If there is another other error other than a clear 404, be optimistic and continue.
                spotImageNameOk = true;
            }
        }
    } while (!spotImageNameOk);
    const spotConfig: SpotSetupConfig = await getSpotSetupConfig(azureSub);
    const deploymentName: string = getDeploymentName();
    const deploymentConfig: IDeploymentTemplateConfig = await configureDeploymentTemplate(spotName,
                                                                                          imageName,
                                                                                          spotRegion,
                                                                                          azureSub,
                                                                                          spotConfig,
                                                                                          acrCreds);
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
    Logging.log('Deployment template for spot creation', deploymentConfig.deploymentTemplate);
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
        Logging.log('Deployment provisioningState', deploymentResult.properties!.provisioningState);
        Logging.log('Deployment correlationId', deploymentResult.properties!.correlationId);
        Logging.log('Deployment completed');
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

/* Spot create from PR related functions */

interface IPrInfo {
    repoUser: string;
    repoName: string;
    prId: string;
    prAcrSource: string;
    headSha?: string;
    dockerFilePath?: string;
}

function validatePrUrl(val: string) {
    // This validation happens character by character so we don't do network calls here
    return (val.indexOf('github.com') === -1 || val.indexOf('/pull/') === -1) ? 'Use a Github PR' : null;
}

function getPrInfo(prUrl: string): IPrInfo | undefined {
    // Use regex or something else here in the future
    // https://github.com/user/repo/pull/id
    // 0/1/2/3/4/5/6
    const segments = prUrl.split('/');
    if (segments.length === 7 && segments[5] === 'pull') {
        return {repoUser: segments[3], repoName: segments[4], prId: segments[6],
                prAcrSource: prUrl.replace('/pull/', '.git#pull/') + '/head'};
    }
}

async function imageInRegistry(acrConfig: IAcrSetupConfig, prImageName: string): Promise<boolean> {
    const imageRepoTag = prImageName.split(':');
    const acrAuthDigest = Buffer.from(`${acrConfig.registryUser}:${acrConfig.registryPass}`).toString('base64');
    try {
        // tslint:disable-next-line:max-line-length
        const acrTagResponse: {tags: string[]} = await request.get(`https://${acrConfig.registryLoginServer}/v2/${imageRepoTag[0]}/tags/list`,
                           {json: true, headers: {Authorization: `Basic ${acrAuthDigest}`}});
        const tagFound = acrTagResponse.tags.find((val) => val === imageRepoTag[1]);
        return tagFound === undefined ? false : true;
    } catch (err) {
        Logging.log('Check image in registry error', err.message);
        return false;
    }
}

async function buildContainerFromPr(azureSub: AzureSubscription,
                                    acrConfig: IAcrSetupConfig,
                                    prImageName: string,
                                    prAcrSource: string,
                                    dockerFilePath: string): Promise<boolean> {
    const acrClient = new ContainerRegistryManagementClient(azureSub.session.credentials,
                                                            azureSub.subscription.subscriptionId!);
    if (await imageInRegistry(acrConfig, prImageName)) {
        // tslint:disable-next-line:max-line-length
        Logging.log(`Found the image ${prImageName} in the registry ${acrConfig.registryLoginServer}. No need to build container.`);
        window.showInformationMessage('The image for this PR and commit is already available to use.');
        return true;
    } else {
        Logging.log(`Image ${prImageName} not found in registry ${acrConfig.registryLoginServer} so building...`);
    }

    // TODO Check that the current image is not already queued for building once this API is made available in ACR

    const buildRequest: ContainerRegistryManagementModels.QuickBuildRequest = {
        dockerFilePath: dockerFilePath,
        imageNames: [prImageName],
        platform: {osType: 'Linux', cpu: 2},
        isPushEnabled: true,
        sourceLocation: prAcrSource,
        type: "QuickBuild"
    };
    Logging.log(`Image name: ${acrConfig.registryLoginServer}/${prImageName}`);
    const queueBuildResult = await acrClient.registries.queueBuild(acrConfig.registryGroup,
                                                                   acrConfig.registryName,
                                                                   buildRequest);
    Logging.log('Queue Build result', queueBuildResult);
    const buildLogLink = await acrClient.builds.getLogLink(acrConfig.registryGroup,
                                                           acrConfig.registryName,
                                                           queueBuildResult.buildId!);
    const viewLogsBtn: MessageItem = { title: "View Logs in browser" };
    Logging.log('Build log link', buildLogLink.logLink);
    window.showInformationMessage(`Building container for PR.`, viewLogsBtn)
    .then((msgItem: MessageItem | undefined) => {
        if (msgItem === viewLogsBtn && buildLogLink.logLink) {
            opn(buildLogLink.logLink);
        }
    });
    let buildTimeout = 1000 * 60 * 20;
    const pollTime = 1000 * 5;
    while (buildTimeout > 0) {
        const cur = await acrClient.builds.get(acrConfig.registryGroup,
                                               acrConfig.registryName,
                                               queueBuildResult.buildId!);
        Logging.log('Current build status', cur.status);
        if (cur.status === 'Succeeded') {
            return true;
        }
        if (cur.status === 'Running' || cur.status === 'Queued') {
            await delay(pollTime);
            buildTimeout -= pollTime;
        } else {
            // Just timeout now as it could have stopped for some reason, possibly an error.
            buildTimeout = 0;
        }
    }
    console.error('The container build timed out. Please try again later.');
    return false;
}

export async function spotCreateFromPR(azureSub: AzureSubscription): Promise<ISpotCreationData> {
    let prUrl: string | undefined;
    let prInfo: IPrInfo | undefined;
    let prUrlOk: boolean = false;
    const spotRegion: string = workspace.getConfiguration('spot').get('azureRegion') || DEFAULT_SPOT_REGION;
    const spotName = await getSpotNameFromUser(spotRegion);
    do {
        prUrl = await window.showInputBox(
            {placeHolder: 'Link to a GitHub Pull Request',
            ignoreFocusOut: true,
            validateInput: validatePrUrl
        });
        if (!prUrl) {
            throw new UserCancelledError('No PR url specified. Operation cancelled.');
        }
        prInfo = getPrInfo(prUrl);
        if (prInfo === undefined) {
            window.showWarningMessage('Unable to parse PR url. Try again.');
            continue;
        }
        try {
            await request.head(`${prUrl}`);
        } catch (err) {
            window.showWarningMessage('Unable to get the pull request. Is the url correct?');
            continue;
        }
        // tslint:disable-next-line:max-line-length
        const ghResponse: any = await request.get(`https://api.github.com/repos/${prInfo!.repoUser}/${prInfo!.repoName}/pulls/${prInfo!.prId}`,
        {json: true, headers: {'User-Agent': 'spot-vs-code-extension'}});
        prInfo.headSha = ghResponse.head.sha;
        for (const dockerfile of ['Dockerfile.spot', 'Dockerfile']) {
            // tslint:disable-next-line:max-line-length
            const reqUri = `https://github.com/${prInfo!.repoUser}/${prInfo!.repoName}/blob/${ghResponse.base.repo.default_branch}/${dockerfile}`;
            try {
                Logging.log(`HEAD request to ${reqUri}`);
                await request.head(reqUri);
                Logging.log(`Using Docker file path as ${dockerfile}`);
                prInfo.dockerFilePath = dockerfile;
                break;
            } catch (err) {
                Logging.log(`Not able to find ${dockerfile}. Request failed for ${reqUri}`, err.message);
            }
        }
        if (prInfo.dockerFilePath === undefined) {
            // tslint:disable-next-line:max-line-length
            window.showWarningMessage('Unable to file Dockerfile or Dockerfile.spot on the default branch of the repository');
            continue;
        }
        prUrlOk = true;
    } while (!prUrlOk);
    const confirmYesMsgItem = {title: 'Yes'};
    const confirmNoMsgItem = {title: 'No'};
    const confimMsgResponse: MessageItem | undefined = await window.showWarningMessage(
        `Are you sure you want to create the spot ${spotName} for ${prInfo!.repoUser}/${prInfo!.repoName} ` +
        `PR #${prInfo!.prId} commit ${prInfo!.headSha!.substring(0, 7)}`,
        confirmYesMsgItem, confirmNoMsgItem);
    if (confimMsgResponse !== confirmYesMsgItem) {
        throw new UserCancelledError('User cancelled spot create operation.');
    }
    window.showInformationMessage('Checking a few things....');
    const spotConfig: SpotSetupConfig = await getSpotSetupConfig(azureSub);
    const acrConfig: IAcrSetupConfig = await getSpotAcrSetupConfig(azureSub, spotConfig);
    const prImageName = `pr-${prInfo!.repoUser}-${prInfo!.repoName}:${prInfo!.prId}-${prInfo!.headSha}`.toLowerCase();
    const buildSuccess = await buildContainerFromPr(azureSub, acrConfig,
                                                    prImageName, prInfo!.prAcrSource, prInfo!.dockerFilePath!);
    if (!buildSuccess) {
        window.showErrorMessage('The container build failed. See logs for details.');
        throw new Error('The container build failed');
    }
    const imageName = `${acrConfig.registryLoginServer}/${prImageName}`;
    // Create the spot
    const acrCreds = {
        server: acrConfig.registryLoginServer,
        username: acrConfig.registryUser,
        password: acrConfig.registryPass
    };
    const deploymentName: string = getDeploymentName();
    const deploymentConfig: IDeploymentTemplateConfig = await configureDeploymentTemplate(spotName,
                                                                                          imageName,
                                                                                          spotRegion,
                                                                                          azureSub,
                                                                                          spotConfig,
                                                                                          acrCreds);
    const deploymentOptions: ResourceModels.Deployment = {
        properties: { mode: 'Incremental', template: deploymentConfig.deploymentTemplate}
    };
    Logging.log('Deployment template for spot creation', deploymentConfig.deploymentTemplate);
    window.showInformationMessage(`Creating spot ${spotName}`);
    const rmClient = new ResourceManagementClient(azureSub.session.credentials,
                                                    azureSub.subscription.subscriptionId!);
    const spotCreationData: ISpotCreationData = {
        useSSL: deploymentConfig.useSSL,
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
        Logging.log('Deployment provisioningState', deploymentResult.properties!.provisioningState);
        Logging.log('Deployment correlationId', deploymentResult.properties!.correlationId);
        Logging.log('Deployment completed');
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
