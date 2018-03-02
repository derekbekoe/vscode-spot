import { window, ExtensionContext, commands } from 'vscode';
import { createTelemetryReporter } from './telemetry';
import TelemetryReporter from 'vscode-extension-telemetry';

let reporter: TelemetryReporter;

export function activate(context: ExtensionContext) {
    reporter = createTelemetryReporter(context);
    context.subscriptions.push(commands.registerCommand('spot.Create', spotCreate));
    context.subscriptions.push(commands.registerCommand('spot.Connect', spotConnect));
    context.subscriptions.push(commands.registerCommand('spot.Disconnect', spotDisconnect));
    context.subscriptions.push(commands.registerCommand('spot.Terminate', spotTerminate));
}

function spotCreate() {
    reporter.sendTelemetryEvent('onCommand/spotCreate');
    window.showInformationMessage('Creating spot!');
}

function spotConnect() {
    reporter.sendTelemetryEvent('onCommand/spotConnect');
    window.showInformationMessage('Connecting to spot!');
}

function spotDisconnect() {
    reporter.sendTelemetryEvent('onCommand/spotDisconnect');
    window.showInformationMessage('Disconnecting from spot!');
}

function spotTerminate() {
    reporter.sendTelemetryEvent('onCommand/spotTerminate');
    window.showInformationMessage('Terminating spot!');
}


export function deactivate() {
    reporter.dispose();
}
