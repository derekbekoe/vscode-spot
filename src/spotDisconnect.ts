import { window, MessageItem, commands } from 'vscode';
import opn = require('opn');

import { SpotSession } from "./spotUtil";
import { SpotFileTracker } from './spotFiles';
import { ipcQueue } from './ipc';

export async function spotDisconnect(session: SpotSession | null, spotFileTracker: SpotFileTracker): Promise<void> {
    if (session != null) {
        // Check if there are any unsaved files from the spot
        for (var te of window.visibleTextEditors) {
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
            window.showInformationMessage('Disconnected from spot. Remember to review your currently running Azure spots to prevent unexpected charges.', portalMsgItem, terminateMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (portalMsgItem === msgItem) {
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
