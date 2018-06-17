import * as fs from 'fs';
import * as request from 'request';
import * as tmp from 'tmp';
import { MessageItem, window, workspace } from 'vscode';

import { ContainerRegistryManagementClient, ContainerRegistryManagementModels } from 'azure-arm-containerregistry';
import { ResourceManagementClient } from 'azure-arm-resource';
import StorageManagementClient = require('azure-arm-storage');
import { FileService } from 'azure-storage';

import { AzureSubscription } from './azure-account.api';
import { randomBytes } from './ipc';
import { Logging } from './logging';
import { SpotSetupError } from './spotUtil';

export const DEFAULT_RG_NAME = 'vscode-spot';

const DEFAULT_SHARE_NAME = 'spot';
const SPOT_HOST_VERSION = 'v0.2.0';

const URL_SPOT_HOST = `https://github.com/derekbekoe/spot/releases/download/${SPOT_HOST_VERSION}/spot-host`;
const URL_SPOT_HOST_PTY = `https://github.com/derekbekoe/spot/releases/download/${SPOT_HOST_VERSION}/pty.node`;
const URL_SPOT_CERTBOT = `https://github.com/derekbekoe/spot/releases/download/${SPOT_HOST_VERSION}/certbot.sh`;

export class SpotSetupConfig {
    constructor(public resourceGroupName: string,
                public azureFileShareName1: string,
                public azureFileShareName2: string,
                public azureStorageAccountName: string,
                public azureStorageAccountKey: string) {}
}

function handleStorageDataPlane<T>(fileService: FileService, func: any, ...args: any[]): Promise<T> {
    return new Promise((resolve, reject) => func.call(fileService, ...args, (err: any, res: T) => {
        if (err) {
            reject(err);
        } else {
            resolve(res);
        }
    }));
}

async function downloadFileToTmp(uri: string): Promise<string> {
    const tmpFile = tmp.fileSync();
    const dest = tmpFile.name;
    const file = fs.createWriteStream(dest);
    return new Promise<string>((resolve, reject) => {
        request(uri)
        .on('error', (e) => {
            console.error('Download temp file error', e);
            reject();
        })
        .on('end', () => {
            Logging.log('Downloaded', uri, dest);
            resolve(dest);
        })
        .pipe(file);
    });
}

export async function getSpotSetupConfig(azureSub: AzureSubscription): Promise<SpotSetupConfig> {
    let resourceGroupName = workspace.getConfiguration('spot').get<string>('azureResourceGroup');
    let azureFileShareName1 = workspace.getConfiguration('spot').get<string>('azureFileShareName1');
    let azureStorageAccountName = workspace.getConfiguration('spot').get<string>('azureStorageAccountName');
    let azureStorageAccountKey = workspace.getConfiguration('spot').get<string>('azureStorageAccountKey');
    if (resourceGroupName) {
        if (azureFileShareName1 && azureStorageAccountName && azureStorageAccountKey) {
            // tslint:disable-next-line:max-line-length no-shadowed-variable
            const azureFileShareName2 = workspace.getConfiguration('spot').get<string>('azureFileShareName2') || azureFileShareName1;
            Logging.log('Using custom spot setup configuration');
            return new SpotSetupConfig(resourceGroupName, azureFileShareName1, azureFileShareName2,
                                       azureStorageAccountName, azureStorageAccountKey);
        } else {
            throw new SpotSetupError('Please set up all the configuration variables.');
        }
    }
    let azureFileShareName2 = '';
    resourceGroupName = DEFAULT_RG_NAME;
    const rmClient = new ResourceManagementClient(azureSub.session.credentials, azureSub.subscription.subscriptionId!);
    const stClient = new StorageManagementClient(azureSub.session.credentials, azureSub.subscription.subscriptionId!);
    if (!await rmClient.resourceGroups.checkExistence(resourceGroupName)) {
        const okMsgItem: MessageItem = {title: 'Ok'};
        const cancelMsgItem: MessageItem = {title: 'Cancel'};
        // tslint:disable-next-line:max-line-length
        const msgItem: MessageItem | undefined = await window.showWarningMessage(`To set things up, we are going to create a resource group named ${resourceGroupName} and provision a storage account.`, okMsgItem, cancelMsgItem);
        if (msgItem === cancelMsgItem || msgItem === undefined) {
            throw new SpotSetupError('Cancelled set up.');
        }
        await rmClient.resourceGroups.createOrUpdate(resourceGroupName, {location: 'westus'});
        Logging.log(`Created resource group ${resourceGroupName}`);
        let newStName = 'spot' + (await randomBytes(10)).toString('hex').toLowerCase().substring(0, 18);
        let stNameAvailable = false;
        for (let i = 0; i < 10 && !stNameAvailable; i++) {
            Logging.log(`Proposed storage account: ${newStName}`);
            if ((await stClient.storageAccounts.checkNameAvailability(newStName)).nameAvailable) {
                stNameAvailable = true;
                break;
            } else {
                Logging.log(`${newStName} is unavailable.`);
                newStName = 'spot' + (await randomBytes(10)).toString('hex').toLowerCase().substring(0, 18);
            }
        }
        if (!stNameAvailable) {
            const errMsg = 'Unable to get a unique storage account name.';
            Logging.log(errMsg);
            await rmClient.resourceGroups.deleteMethod(resourceGroupName);
            throw new SpotSetupError(`${errMsg} Please try again.`);
        }
        azureStorageAccountName = newStName;
        Logging.log(`Found unique storage account name of '${azureStorageAccountName}'. Creating storage account...`);
        await stClient.storageAccounts.create(resourceGroupName,
                                              azureStorageAccountName,
                                              {sku: {name: 'Standard_LRS'},
                                               kind: 'Storage', location: 'westus'});
        Logging.log('Created storage account successfully.');
        const stKeysResult = await stClient.storageAccounts.listKeys(resourceGroupName, azureStorageAccountName);
        if (stKeysResult === undefined || stKeysResult.keys === undefined) {
            Logging.log('Unable to get storage account key.');
            await rmClient.resourceGroups.deleteMethod(resourceGroupName);
            throw new SpotSetupError(`Please try again.`);
        }
        azureStorageAccountKey = stKeysResult.keys[0].value;
        const fileService = new FileService(azureStorageAccountName, azureStorageAccountKey);
        azureFileShareName1 = DEFAULT_SHARE_NAME;
        Logging.log(`Creating share in storage account '${azureStorageAccountName}', name '${azureFileShareName1}'`);
        await handleStorageDataPlane<FileService.ShareResult>(fileService,
                                                              FileService.prototype.createShareIfNotExists,
                                                              azureFileShareName1);
        Logging.log('Created share successfully.');
        Logging.log('Downloading spot host resources.');
        const tmpSpotHost: string = await downloadFileToTmp(URL_SPOT_HOST);
        const tmpSpotHostPtyNode: string = await downloadFileToTmp(URL_SPOT_HOST_PTY);
        const tmpSpotCertbot: string = await downloadFileToTmp(URL_SPOT_CERTBOT);
        Logging.log('Uploading spot host resources.');
        await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                             FileService.prototype.createFileFromLocalFile,
                                                             azureFileShareName1,
                                                             '',
                                                             'spot-host',
                                                             tmpSpotHost);
        await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                             FileService.prototype.createFileFromLocalFile,
                                                             azureFileShareName1,
                                                             '',
                                                             'pty.node',
                                                             tmpSpotHostPtyNode);
        await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                             FileService.prototype.createFileFromLocalFile,
                                                             azureFileShareName1,
                                                             '',
                                                             'certbot.sh',
                                                             tmpSpotCertbot);
        window.showInformationMessage(`Set up completed successfully...`);
    } else {
        Logging.log(`Resource group '${resourceGroupName}' exists so using that.`);
        const stAccounts = await stClient.storageAccounts.listByResourceGroup(resourceGroupName);
        if (stAccounts.length !== 1) {
            Logging.log(`Expected only 1 storage account. Found ${stAccounts.length}`);
            throw new SpotSetupError(`Please delete the '${resourceGroupName}' resource group and try again.`);
        }
        azureStorageAccountName = stAccounts[0].name!;
        const stKeysResult = await stClient.storageAccounts.listKeys(resourceGroupName, azureStorageAccountName);
        if (stKeysResult === undefined || stKeysResult.keys === undefined) {
            Logging.log(`Unable to get storage account key.`);
            throw new SpotSetupError(`Please delete the '${resourceGroupName}' resource group and try again.`);
        }
        azureStorageAccountKey = stKeysResult.keys[0].value;
        const fileService = new FileService(azureStorageAccountName, azureStorageAccountKey);
        azureFileShareName1 = DEFAULT_SHARE_NAME;
        const shareResult = await handleStorageDataPlane<FileService.ShareResult>(fileService,
                                                                                FileService.prototype.doesShareExist,
                                                                                azureFileShareName1);
        if (!shareResult.exists) {
            Logging.log(`Share ${azureFileShareName1} does not exist in storage account ${azureStorageAccountName}`);
            throw new SpotSetupError(`Please delete the '${resourceGroupName}' resource group and try again.`);
        }
        if (!(await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                                   FileService.prototype.doesFileExist,
                                                                   azureFileShareName1,
                                                                   '', 'spot-host')).exists ||
            !(await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                                   FileService.prototype.doesFileExist,
                                                                   azureFileShareName1,
                                                                   '', 'pty.node')).exists ||
            !(await handleStorageDataPlane<FileService.FileResult>(fileService,
                                                                   FileService.prototype.doesFileExist,
                                                                   azureFileShareName1,
                                                                   '', 'certbot.sh')).exists) {
            // tslint:disable-next-line:max-line-length
            const errMsg: string = `The share ${azureFileShareName1} in storage account ${azureStorageAccountName} does not contain the required files`;
            Logging.log(errMsg);
            // tslint:disable-next-line:max-line-length
            throw new SpotSetupError(`${errMsg}. Please delete the '${resourceGroupName}' resource group and try again.`);
        }
    }
    if (azureFileShareName1 && azureStorageAccountName && azureStorageAccountKey) {
        azureFileShareName2 = azureFileShareName2 || azureFileShareName1;
        return new SpotSetupConfig(resourceGroupName, azureFileShareName1, azureFileShareName2,
            azureStorageAccountName, azureStorageAccountKey);
    } else {
        throw new SpotSetupError(`Please delete the '${resourceGroupName}' resource group and try again.`);
    }
}

export interface IAcrSetupConfig {
    registryName: string;
    registryUser: string;
    registryPass: string;
    registryLoginServer: string;
    registryGroup: string;
}

export async function getSpotAcrSetupConfig(azureSub: AzureSubscription,
                                            sConfig: SpotSetupConfig): Promise<IAcrSetupConfig> {
    const acrClient = new ContainerRegistryManagementClient(azureSub.session.credentials,
        azureSub.subscription.subscriptionId!);
    const registries = await acrClient.registries.listByResourceGroup(sConfig.resourceGroupName);
    let spotRegistry: ContainerRegistryManagementModels.Registry;
    if (registries.length === 0) {
        // Create registry since it's not in this resource group
        let newAcrName = 'spot' + (await randomBytes(10)).toString('hex').toLowerCase().substring(0, 18);
        let nameAvailable = false;
        for (let i = 0; i < 10 && !nameAvailable; i++) {
            Logging.log(`Proposed ACR: ${newAcrName}`);
            if (await acrClient.registries.checkNameAvailability({name: newAcrName})) {
                nameAvailable = true;
                break;
            } else {
                Logging.log(`${newAcrName} is unavailable.`);
                newAcrName = 'spot' + (await randomBytes(10)).toString('hex').toLowerCase().substring(0, 18);
            }
        }
        if (!newAcrName) {
            const errMsg = 'Unable to get a unique container registry name.';
            Logging.log(errMsg);
            throw new SpotSetupError(`${errMsg} Please try again.`);
        }
        Logging.log(`Found unique container registry name of '${newAcrName}'. Creating container registry...`);
        const okMsgItem: MessageItem = {title: 'Ok'};
        const cancelMsgItem: MessageItem = {title: 'Cancel'};
        // tslint:disable-next-line:max-line-length
        const msgItem: MessageItem | undefined = await window.showWarningMessage(`To set things up, we are going to provision a container registry named ${newAcrName} in the resource group ${sConfig.resourceGroupName}.`, okMsgItem, cancelMsgItem);
        if (msgItem === cancelMsgItem || msgItem === undefined) {
            throw new SpotSetupError('Cancelled set up.');
        }
        // For now, go with westus2 but we shouldn't hard-code this in the future.
        spotRegistry = await acrClient.registries.create(sConfig.resourceGroupName, newAcrName,
                                                         {location: 'westus2', sku: {name: 'Standard'},
                                                         adminUserEnabled: true});
    } else if (registries.length === 1) {
        spotRegistry = registries[0];
    } else {
        Logging.log(`Expected only 1 ACR registry. Found ${registries.length}`);
        throw new SpotSetupError(`Please delete the '${sConfig.resourceGroupName}' resource group and try again.`);
    }
    const regCreds = await acrClient.registries.listCredentials(sConfig.resourceGroupName, spotRegistry.name!);
    return {
        registryName: spotRegistry.name!,
        registryGroup: sConfig.resourceGroupName,
        registryLoginServer: spotRegistry.loginServer!,
        registryUser: regCreds.username!,
        registryPass: regCreds.passwords![0].value!
    };
}
