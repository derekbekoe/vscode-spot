import { window, ExtensionContext, commands } from 'vscode';

export function activate(context: ExtensionContext) {
    context.subscriptions.push(commands.registerCommand('spot.Create', spotCreate));
    context.subscriptions.push(commands.registerCommand('spot.Connect', spotConnect));
    context.subscriptions.push(commands.registerCommand('spot.Disconnect', spotDisconnect));
    context.subscriptions.push(commands.registerCommand('spot.Terminate', spotTerminate));
}

function spotCreate() {
    window.showInformationMessage('Creating spot!');
}

function spotConnect() {
    window.showInformationMessage('Connecting to spot!');
}

function spotDisconnect() {
    window.showInformationMessage('Disconnecting from spot!');
}

function spotTerminate() {
    window.showInformationMessage('Terminating spot!');
}


export function deactivate() {
}
