import { window, Extension, ExtensionContext, extensions, commands, StatusBarAlignment, StatusBarItem, MessageItem } from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as path from 'path';
import * as request from 'request';
import opn = require('opn');
import { AzureAccount, AzureSubscription } from './azure-account.api';
import { createTelemetryReporter } from './telemetry';
import { createServer, readJSON, Queue, randomBytes } from './ipc';
import { SpotTreeDataProvider } from './spotTreeDataProvider';
import { SpotFileTracker, openFileEditor } from './spotFiles';
import { SpotSession } from './session';
import { deploymentTemplate } from './spotDeploy';
import { ResourceManagementClient, ResourceModels } from 'azure-arm-resource';

let reporter: TelemetryReporter;
let spotTreeDataProvider: SpotTreeDataProvider;
let statusBarItem: StatusBarItem;
let activeSession: SpotSession | null;
let spotFileTracker: SpotFileTracker;
let azureAccount: AzureAccount | undefined;

export function activate(context: ExtensionContext) {
    reporter = createTelemetryReporter(context);
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);
    spotFileTracker = new SpotFileTracker();
    const azureAccountExtension: Extension<AzureAccount> | undefined = extensions.getExtension<AzureAccount>('ms-vscode.azure-account');
    azureAccount = azureAccountExtension ? azureAccountExtension.exports : undefined;
    spotTreeDataProvider = new SpotTreeDataProvider(spotFileTracker);
    window.registerTreeDataProvider('spotExplorer', spotTreeDataProvider);
    context.subscriptions.push(commands.registerCommand('spot.Create', cmdSpotCreate));
    context.subscriptions.push(commands.registerCommand('spot.Connect', cmdSpotConnect));
    context.subscriptions.push(commands.registerCommand('spot.Disconnect', cmdSpotDisconnect));
    context.subscriptions.push(commands.registerCommand('spot.Terminate', cmdSpotTerminate));
    context.subscriptions.push(commands.registerCommand('spot.OpenFileEditor', openFileEditor));
    context.subscriptions.push(commands.registerCommand('spot.OpenSpotInBrowser', openSpotInBrowser));
}

function openSpotInBrowser() {
    if (activeSession) {
        opn(activeSession.hostname + '?token=' + activeSession.token);
    }
}

function updateStatusBar(text: string) {
    statusBarItem.text = `Spot: ${text}`;
    if (activeSession) {
        statusBarItem.command = 'spot.OpenSpotInBrowser';
        statusBarItem.tooltip = 'Open spot in browser';
    } else {
        statusBarItem.command = undefined;
        statusBarItem.tooltip = undefined;
    }
    statusBarItem.show();
}

function cmdSpotCreate() {
    reporter.sendTelemetryEvent('onCommand/spotCreate');
    if (!azureAccount) {
        window.showErrorMessage("The Azure Account Extension is required to create spots");
        return;
    }
    if (azureAccount.status !== 'LoggedIn') {
        window.showWarningMessage("Log in and try again.");
        commands.executeCommand("azure-account.login");
        return;
    }
    const candidateSubscriptions = azureAccount.filters.filter((sub: AzureSubscription) => {
        if (sub.subscription.id === undefined || sub.subscription.displayName === undefined || sub.subscription.subscriptionId === undefined || sub.subscription.state !== 'Enabled') {
            return false;
        }
        return true;
    });
    if (candidateSubscriptions.length !== 1) {
        window.showWarningMessage("Choose a single enabled Azure subscription and try again.");
        commands.executeCommand("azure-account.selectSubscriptions");
        return;
    }
    window.showInputBox({placeHolder: 'Name of spot.', ignoreFocusOut: true, validateInput: (val) => {
        return !val.includes(' ') ? null : 'Name cannot contain spaces';
    }}).then((spotName) => {
        if (!spotName) {
            return;
        }
        window.showInputBox({placeHolder: 'Container image name (e.g. ubuntu:xenial)', ignoreFocusOut: true}).then((imageName) => {
            if (!imageName) {
                return
            }
            window.showInformationMessage(`Creating spot ${spotName}`);
            randomBytes(256).then((buffer) => {
                const instanceToken = buffer.toString('hex');
                // TODO Create the RG if it doesn't exist
                const resourceGroupName: string = 'debekoe-spot';
                const date = new Date();
                const dateDay = date.getUTCDate();
                const dateMonth = date.getUTCMonth();
                const dateYr = date.getUTCFullYear();
                const dateHr = date.getUTCHours();
                const dateMin = date.getUTCMinutes();
                const dateSec = date.getUTCSeconds();
                const deploymentName: string = `spot-deployment-${dateDay}-${dateMonth}-${dateYr}-${dateHr}-${dateMin}-${dateSec}`;
                deploymentTemplate.variables.spotName = `${spotName}`;
                deploymentTemplate.variables.container1image = imageName;
                deploymentTemplate.variables.instanceToken = instanceToken;
                // TODO Re-enable SSL - Lets Encrypt Rate Limits can sometimes cause domain verification to fail
                const useSSL = false;
                if (!useSSL) {
                    deploymentTemplate.variables.useSSL = '0';
                }

                const deploymentOptions: ResourceModels.Deployment = {
                    properties: {
                        mode: 'Incremental',
                        template: deploymentTemplate
                    }
                };
                console.log('Deployment template for spot creation', deploymentTemplate);
                const rmClient = new ResourceManagementClient(candidateSubscriptions[0].session.credentials, candidateSubscriptions[0].subscription.subscriptionId!);
                rmClient.deployments.createOrUpdate(resourceGroupName,
                    deploymentName, deploymentOptions)
                    .then((res: ResourceModels.DeploymentExtended) => {
                        console.log('Deployment provisioningState', res.properties!.provisioningState);
                        console.log('Deployment correlationId', res.properties!.correlationId);
                        console.log('Deployment completed');
                        const hostname = useSSL ? `https://${spotName}.westus.azurecontainer.io:443` : `http://${spotName}.westus.azurecontainer.io:80`;
                        console.log(`Requesting health check from ${hostname}`);
                        request.get(`${hostname}/health-check?token=${instanceToken}`, {timeout: 60*1000}, (err, res, body) => {
                            if (err) {
                                return console.error('Spot health check failed', err);
                            }
                            console.log('Health check successful.', body);
                            const connectItem: MessageItem = {title: 'Connect'};
                            window.showInformationMessage('Spot created successfully', connectItem)
                            .then((msgItem: MessageItem | undefined) => {
                                if (msgItem === connectItem) {
                                    connectToSpot(hostname, instanceToken);
                                }
                            });
                        });
                    })
                    .catch((reason: any) => {
                        console.error('Deployment failed', reason);
                        window.showErrorMessage(`Unable to create spot: ${reason}`);
                    });
            });
        });
    });
}

function isKnownSpot(spotName: string) {
    const knownSpots: string[] = ['blue-mountain-123'];
    return knownSpots.indexOf(spotName) > -1;
}

const ipcQueue = new Queue<any>();

async function createSpotConsole(session: SpotSession): Promise<void> {
    const hostname = session.hostname;
    const token = session.token;
    let shellPath = path.join(__dirname, '../../console_bin/node.sh');
    let modulePath = path.join(__dirname, 'consoleLauncher');
    const shellArgs = [
        process.argv0,
        '-e',
        `require('${modulePath}').main()`
    ]
    // ipc
    const ipc = await createServer('vscode-spot-console', async (req, res) => {
        let dequeue = false;
        for (const message of await readJSON<any>(req)) {
            if (message.type === 'poll') {
                dequeue = true;
            } else if (message.type === 'log') {
                console.log(...message.args);
            } else if (message.type === 'status') {
                // state.status = message.status;
                // event.fire(state.status);
            }
        }
        let response = [];
        if (dequeue) {
            try {
                response = await ipcQueue.dequeue(60000);
            } catch (err) {
                // ignore timeout
            }
        }
        res.write(JSON.stringify(response));
        res.end();
    });
    const terminal = window.createTerminal({
        name: `Spot ${hostname}`,
        shellPath: shellPath,
        shellArgs: shellArgs,
        env: {'CONSOLE_IPC': ipc.ipcHandlePath}
    });
    terminal.show();
    ipcQueue.push({
        type: 'connect',
        accessToken: token,
        consoleUri: hostname
    });
}

function connectToSpot(hostname: string, token: string): Promise<null> {
    const mockConnectSuccess = true;
    return new Promise((resolve, reject) => {
        if (mockConnectSuccess) {
            activeSession = new SpotSession(hostname, token);
            spotFileTracker.connect(activeSession);
            createSpotConsole(activeSession).then(() => {
                commands.executeCommand('setContext', 'canShowSpotExplorer', true);
                window.showInformationMessage(`Connected to ${hostname}`);
                updateStatusBar(`${hostname} (connected)`);
                resolve();
            }).catch(() => {
                activeSession = null;
                commands.executeCommand('setContext', 'canShowSpotExplorer', false);
                console.error('An error occurred whilst creating spot console.');
            });
        } else {
            activeSession = null;
            commands.executeCommand('setContext', 'canShowSpotExplorer', false);
            window.showErrorMessage(`Failed to connect to ${hostname}`);
            updateStatusBar('Not connected');
            statusBarItem.show();
            reject();
        }
    });
}

function cmdSpotConnect() {
    reporter.sendTelemetryEvent('onCommand/spotConnect');
    window.showInputBox({placeHolder: 'Spot to connect to.', ignoreFocusOut: true}).then((spotName) => {
        if (!spotName) {
            return;
        }
        if (isKnownSpot(spotName)) {
            const mockToken = 's9kZHwTzJuH8YLQnWKPe';
            connectToSpot(spotName, mockToken);
        } else {
            window.showInputBox({placeHolder: 'Token for the spot.', password: true, ignoreFocusOut: true}).then((spotToken) => {
                if (spotToken) {
                    connectToSpot(spotName, spotToken);
                }
            });
        }
    });
}

function cmdSpotDisconnect() {
    reporter.sendTelemetryEvent('onCommand/spotDisconnect');
    if (activeSession != null) {
        // Check if there are any unsaved files from the spot
        for (var te of window.visibleTextEditors) {
            if (te.document.isDirty && te.document.fileName.indexOf('_spot') > -1) {
                window.showWarningMessage('Please save unsaved files in spot.');
                return;
            }
        }
        spotFileTracker.disconnect();
        ipcQueue.push({ type: 'exit' });
        commands.executeCommand('setContext', 'canShowSpotExplorer', false);
        window.showInformationMessage('Disconnected from spot.');
    } else {
        window.showInformationMessage('Not currently connected to a spot.');
    }
    activeSession = null;
    updateStatusBar('Not connected');
}

function cmdSpotTerminate() {
    reporter.sendTelemetryEvent('onCommand/spotTerminate');
    window.showInformationMessage('Terminating spot!');
    updateStatusBar('Not connected');
}

export function deactivate() {
    reporter.dispose();
}
