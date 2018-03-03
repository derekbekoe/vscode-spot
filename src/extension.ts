import { window, ExtensionContext, commands, StatusBarAlignment, StatusBarItem } from 'vscode';
import { createTelemetryReporter } from './telemetry';
import TelemetryReporter from 'vscode-extension-telemetry';

let reporter: TelemetryReporter;
let statusBarItem: StatusBarItem;

export function activate(context: ExtensionContext) {
    reporter = createTelemetryReporter(context);
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(commands.registerCommand('spot.Create', cmdSpotCreate));
    context.subscriptions.push(commands.registerCommand('spot.Connect', cmdSpotConnect));
    context.subscriptions.push(commands.registerCommand('spot.Disconnect', cmdSpotDisconnect));
    context.subscriptions.push(commands.registerCommand('spot.Terminate', cmdSpotTerminate));
}

function updateStatusBar(text: string) {
    statusBarItem.text = `Spot: ${text}`;
    statusBarItem.show();
}

function mockDelay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cmdSpotCreate() {
    reporter.sendTelemetryEvent('onCommand/spotCreate');
    window.showInputBox({placeHolder: 'Name of spot.'}).then((spotName) => {
        if (!spotName) {
            return;
        }
        const items: string[] = ['ASP.NET webapp', 'Python Flask webapp'];
        window.showQuickPick(items).then((val) => {
            window.showInformationMessage(`Creating spot ${spotName}`);
            // TODO Actually create the spot here.
            // TODO Save hostname and token in file so it can be connected to.
            mockDelay(5000).then(() => {
                const mockToken = 's9kZHwTzJuH8YLQnWKPe';
                window.showInformationMessage(`Spot created`);
                connectToSpot(spotName, mockToken);
            });
        });
    });
}

function isKnownSpot(spotName: string) {
    const knownSpots: string[] = ['blue-mountain-123'];
    return knownSpots.indexOf(spotName) > -1;
}

function connectToSpot(hostname: string, token: string): Promise<null> {
    // TODO Attempt to connect to the spot. If success, do the following. If error, show notification. If spot not ready yet but is available, show message and wait.
    // TODO Open terminal
    // TODO Add entry to left navigation
    // TODO Modify status bar
    const mockConnectSuccess = true;
    return new Promise((resolve, reject) => {
        if (mockConnectSuccess) {
            mockDelay(5000).then(() => {
                window.showInformationMessage(`Connected to ${hostname}`);
                updateStatusBar(`${hostname} (connected)`);
                resolve();
            });
        } else {
            mockDelay(3000).then(() => {
                window.showErrorMessage(`Failed to connect to ${hostname}`);
                updateStatusBar('Not connected');
                statusBarItem.show();
                reject();
            });
        }
    });
}

function cmdSpotConnect() {
    reporter.sendTelemetryEvent('onCommand/spotConnect');
    window.showInputBox({placeHolder: 'Spot to connect to.'}).then((spotName) => {
        if (!spotName) {
            return;
        }
        if (isKnownSpot(spotName)) {
            // window.showInformationMessage(`Attempting to connect to spot ${spotName}`);
            const mockToken = 's9kZHwTzJuH8YLQnWKPe';
            connectToSpot(spotName, mockToken);
        } else {
            window.showInputBox({placeHolder: 'Token for the spot.', password: true}).then((spotToken) => {
                if (spotToken) {
                    // window.showInformationMessage(`Attempting to connect to '${spotName}' with token '${spotToken}'`);
                    connectToSpot(spotName, spotToken);
                }
            });
        }
    });
}

function cmdSpotDisconnect() {
    reporter.sendTelemetryEvent('onCommand/spotDisconnect');
    window.showInformationMessage('Disconnecting from spot!');
}

function cmdSpotTerminate() {
    reporter.sendTelemetryEvent('onCommand/spotTerminate');
    window.showInformationMessage('Terminating spot!');
}

export function deactivate() {
    reporter.dispose();
}
