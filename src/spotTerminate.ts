import opn = require('opn');
import { MessageItem, window, workspace } from 'vscode';

import { ResourceManagementClient } from 'azure-arm-resource';
import { AzureSubscription } from './azure-account.api';

import { Logging } from './logging';
import { DEFAULT_RG_NAME } from './spotSetup';
import { KnownSpots, UserCancelledError } from "./spotUtil";

const AZURE_ACI_RP: string = "Microsoft.ContainerInstance";
const AZURE_ACI_RT: string = "containerGroups";

/* tslint:disable:max-classes-per-file */

export class MissingConfigVariablesError extends Error {}
export class ACIDeleteError extends Error {}

export async function spotTerminate(azureSub: AzureSubscription, knownSpots: KnownSpots): Promise<void> {
    const knownSpotsKeys = Object.keys(knownSpots.getAll());
    const spotName: string | undefined = await window.showQuickPick(Array.from(knownSpotsKeys),
                                                                    {placeHolder: 'Name of spot to terminate/delete.',
                                                                    ignoreFocusOut: true});
    if (!spotName) {
        throw new UserCancelledError('No spot name specified. Operation cancelled.');
    }
    const confirmYesMsgItem = {title: 'Yes'};
    const confirmNoMsgItem = {title: 'No'};
    // tslint:disable-next-line:max-line-length
    const delMsgItem: MessageItem | undefined = await window.showWarningMessage(`Are you sure you want to delete the spot ${spotName}`,
                                                                                confirmYesMsgItem, confirmNoMsgItem);
    if (delMsgItem !== confirmYesMsgItem) {
        throw new UserCancelledError('User cancelled spot delete operation.');
    }
    Logging.log(`Attempting to terminate spot ${spotName}`);
    window.showInformationMessage(`Attempting to terminate spot ${spotName}`);
    const rmClient = new ResourceManagementClient(azureSub.session.credentials, azureSub.subscription.subscriptionId!);
    const resourceGroupName = workspace.getConfiguration('spot').get<string>('azureResourceGroup') || DEFAULT_RG_NAME;
    if (!resourceGroupName) {
        const moreInfoItem: MessageItem = {title: 'More Info'};
        window.showErrorMessage('Please set up the resource group in the configuration.', moreInfoItem)
        .then((msgItem: MessageItem | undefined) => {
            if (msgItem === moreInfoItem) {
                opn('https://github.com/derekbekoe/vscode-spot#configuration');
            }
        });
        throw new MissingConfigVariablesError();
    }
    try {
        await rmClient.resources.deleteMethod(resourceGroupName,
                                              AZURE_ACI_RP,
                                              "",
                                              AZURE_ACI_RT,
                                              spotName,
                                              "2018-04-01");
    } catch (err) {
        throw new ACIDeleteError(err);
    }
    Logging.log('Spot deleted');
    window.showInformationMessage('Spot terminated!');
    knownSpots.remove(spotName);
}
