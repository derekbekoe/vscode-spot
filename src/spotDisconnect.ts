import opn = require('opn');
import { commands, MessageItem, window } from 'vscode';

import { ipcQueue } from './ipc';
import { SpotFileTracker } from './spotFiles';
import { SpotSession } from "./spotUtil";

export async function spotDisconnect(session: SpotSession | null, spotFileTracker: SpotFileTracker): Promise<void> {
    if (session != null) {
        // Check if there are any unsaved files from the spot
        for (const te of window.visibleTextEditors) {
            if (te.document.isDirty && te.document.fileName.indexOf('_spot') > -1) {
                window.showWarningMessage('Please save unsaved files in spot.');
                throw new Error('Unsaved spot files should be saved or closed before disconnecting.');
            }
        }
        spotFileTracker.disconnect();
        ipcQueue.push({ type: 'exit' });
        if (session.hostname.indexOf('azurecontainer.io') > -1) {
            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
            const terminateMsgItem: MessageItem = {title: 'Terminate'};
            // tslint:disable-next-line:max-line-length
            window.showInformationMessage('Disconnected from spot. Remember to review your currently running Azure spots to prevent unexpected charges.', portalMsgItem, terminateMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (portalMsgItem === msgItem) {
                    // tslint:disable-next-line:max-line-length
                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                } else if (terminateMsgItem === msgItem) {
                    commands.executeCommand('spot.Terminate');
                }
            });
        } else {
            window.showInformationMessage('Disconnected from spot.');
        }
    } else {
        window.showInformationMessage('Not currently connected to a spot.');
    }
}
