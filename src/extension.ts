import { window, Extension, ExtensionContext, extensions, commands, StatusBarAlignment, StatusBarItem, MessageItem, workspace } from 'vscode';
import { TelemetryReporter, TelemetryResult } from './telemetry';
import * as path from 'path';
import * as requestretry from 'requestretry';
import * as cp from 'child_process';
import * as semver from 'semver';
import opn = require('opn');
import { URL } from 'url';
import { AzureAccount, AzureSubscription } from './azure-account.api';
import { ResourceManagementClient, ResourceModels } from 'azure-arm-resource';

import { createTelemetryReporter } from './telemetry';
import { createServer, readJSON, Queue, randomBytes } from './ipc';
import { SpotTreeDataProvider } from './spotTreeDataProvider';
import { SpotFileTracker, openFileEditor } from './spotFiles';
import { SpotSession } from './session';
import { deploymentTemplate, certbotContainer, userContainer } from './spotDeploy';
import { KnownSpots } from './spotUtil';

let reporter: TelemetryReporter;
let spotTreeDataProvider: SpotTreeDataProvider;
let statusBarItem: StatusBarItem;
let activeSession: SpotSession | null;
let spotFileTracker: SpotFileTracker;
let azureAccount: AzureAccount | undefined;
let knownSpots: KnownSpots;

export function activate(context: ExtensionContext) {
    reporter = createTelemetryReporter(context);
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);
    spotFileTracker = new SpotFileTracker();
    knownSpots = new KnownSpots();
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

function getAzureSubscription(): AzureSubscription | undefined {
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
    return candidateSubscriptions[0];
}

function spotHealthCheck(hostname: string, instanceToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
        console.log(`Requesting health check from ${hostname}`);
        requestretry({url: `${hostname}/health-check?token=${instanceToken}`, timeout: 60*1000, maxAttempts: 5, retryDelay: 5000}, (err, res, body) => {
            if (err) {
                console.error('Spot health check failed', err);
                reject(err);
            } else {
                console.log('Health check successful.', body);
                resolve();
            }
        });
    });
}

function cmdSpotCreate() {
    reporter.sendTelemetryEvent('onCommand/spotCreate');
    reporter.sendTelemetryEvent('spotCreate/initiate');
    const azureSub = getAzureSubscription();
    if (!azureSub) {
        reporter.sendTelemetryEvent('spotCreate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'NO_AZURE_SUBSCRIPTION'});
        return;
    }
    const resourceGroupName = workspace.getConfiguration('spot').get<string>('azureResourceGroup');
    const azureFileShareName1 = workspace.getConfiguration('spot').get<string>('azureFileShareName1');
    const azureFileShareName2 = workspace.getConfiguration('spot').get<string>('azureFileShareName2');
    const azureStorageAccountName = workspace.getConfiguration('spot').get<string>('azureStorageAccountName');
    const azureStorageAccountKey = workspace.getConfiguration('spot').get<string>('azureStorageAccountKey');

    if (!resourceGroupName || !azureFileShareName1 || !azureStorageAccountName || !azureStorageAccountKey) {
        const moreInfoItem: MessageItem = {title: 'More Info'};
        window.showErrorMessage('Please set up the configuration variables.', moreInfoItem)
        .then((msgItem: MessageItem | undefined) => {
            if (msgItem === moreInfoItem) {
                opn('https://github.com/derekbekoe/vscode-spot#configuration');
            }
        });
        reporter.sendTelemetryEvent('spotCreate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'MISSING_CONFIGURATION_VARIABLES'});
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
            randomBytes(256).then((buffer) => {
                const instanceToken = buffer.toString('hex');
                const date = new Date();
                const dateDay = date.getUTCDate();
                const dateMonth = date.getUTCMonth();
                const dateYr = date.getUTCFullYear();
                const dateHr = date.getUTCHours();
                const dateMin = date.getUTCMinutes();
                const dateSec = date.getUTCSeconds();
                const deploymentName: string = `spot-deployment-${dateDay}-${dateMonth}-${dateYr}-${dateHr}-${dateMin}-${dateSec}`;
                const spotRegion: string = workspace.getConfiguration('spot').get('azureRegion') || 'westus';
                deploymentTemplate.variables.spotName = `${spotName}`;
                deploymentTemplate.variables.container1image = imageName;
                deploymentTemplate.variables.instanceToken = instanceToken;
                deploymentTemplate.variables.certbotEmail = azureSub.session.userId;
                deploymentTemplate.variables.location = spotRegion;

                deploymentTemplate.variables.azureFileShareName1 = azureFileShareName1;
                deploymentTemplate.variables.azureFileShareName2 = azureFileShareName2 || azureFileShareName1;
                deploymentTemplate.variables.azureStorageAccountName1 = azureStorageAccountName;
                deploymentTemplate.variables.azureStorageAccountKey1 = azureStorageAccountKey;
                deploymentTemplate.variables.azureStorageAccountName2 = azureStorageAccountName;
                deploymentTemplate.variables.azureStorageAccountKey2 = azureStorageAccountKey;
                deploymentTemplate.variables.fileWatcherWatchPath = workspace.getConfiguration('spot').get('fileWatcherWatchPath') || '/root';

                const useSSL = workspace.getConfiguration('spot').get('createSpotWithSSLEnabled', false);
                if (useSSL) {
                    console.log('Spot will be created with SSL enabled.');
                    deploymentTemplate.variables.useSSL = '1';
                    deploymentTemplate.variables.container1port = '443';
                    deploymentTemplate.resources[0].properties.containers = [userContainer, certbotContainer];
                } else {
                    console.log('Spot will be created with SSL disabled.');
                    deploymentTemplate.variables.useSSL = '0';
                    deploymentTemplate.variables.container1port = '80';
                    deploymentTemplate.resources[0].properties.containers = [userContainer];
                }

                const deploymentOptions: ResourceModels.Deployment = {
                    properties: {
                        mode: 'Incremental',
                        template: deploymentTemplate
                    }
                };
                console.log('Deployment template for spot creation', deploymentTemplate);
                window.showInformationMessage(`Creating spot ${spotName}`);
                const rmClient = new ResourceManagementClient(azureSub.session.credentials, azureSub.subscription.subscriptionId!);
                rmClient.deployments.createOrUpdate(resourceGroupName,
                    deploymentName, deploymentOptions)
                    .then((res: ResourceModels.DeploymentExtended) => {
                        console.log('Deployment provisioningState', res.properties!.provisioningState);
                        console.log('Deployment correlationId', res.properties!.correlationId);
                        console.log('Deployment completed');
                        window.showInformationMessage(`Deployment completed. Running health check for ${spotName}`);
                        const hostname = useSSL ? `https://${spotName}.${spotRegion}.azurecontainer.io:443` : `http://${spotName}.${spotRegion}.azurecontainer.io:80`;
                        spotHealthCheck(hostname, instanceToken)
                        .then(() => {
                            reporter.sendTelemetryEvent('spotCreate/conclude',
                                                        {'spot.result': TelemetryResult.SUCCESS,
                                                         'spot.detail.useSSL': String(useSSL),
                                                         'spot.detail.imageName': imageName,
                                                         'spot.detail.spotRegion': spotRegion});
                            knownSpots.add(spotName, hostname, instanceToken);
                            const connectItem: MessageItem = {title: 'Connect'};
                            window.showInformationMessage('Spot created successfully', connectItem)
                            .then((msgItem: MessageItem | undefined) => {
                                if (msgItem === connectItem) {
                                    connectToSpot(hostname, instanceToken);
                                }
                            });
                        })
                        .catch((err) => {
                            console.error('Spot health check failed', err);
                            reporter.sendTelemetryEvent('spotCreate/conclude',
                                                        {'spot.result': TelemetryResult.ERROR,
                                                         'spot.reason': 'HEALTH_CHECK_FAILURE',
                                                         'spot.detail.useSSL': String(useSSL),
                                                         'spot.detail.imageName': imageName,
                                                         'spot.detail.spotRegion': spotRegion});
                            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
                            window.showErrorMessage(`Spot health check failed for ${spotName}: Check the container logs in the Portal.`, portalMsgItem)
                            .then((msgItem: MessageItem | undefined) => {
                                if (portalMsgItem === msgItem) {
                                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                                }
                            });
                        });
                    })
                    .catch((reason: any) => {
                        console.error('Deployment failed', reason);
                        window.showErrorMessage(`Unable to create spot: ${reason}`);
                        reporter.sendTelemetryEvent('spotCreate/conclude',
                                                        {'spot.result': TelemetryResult.ERROR,
                                                         'spot.reason': 'DEPLOYMENT_FAILURE',
                                                         'spot.detail.useSSL': String(useSSL),
                                                         'spot.detail.imageName': imageName,
                                                         'spot.detail.spotRegion': spotRegion});
                    });
            });
        });
    });
}

const ipcQueue = new Queue<any>();

// Adapted from https://github.com/Microsoft/vscode-azure-account
async function createSpotConsole(session: SpotSession): Promise<void> {
    const isWindows = process.platform === 'win32';
    const hostname = session.hostname;
    const token = session.token;
    let shellPath = isWindows ? 'node.exe' : path.join(__dirname, '../../console_bin/node.sh');
    let modulePath = path.join(__dirname, 'consoleLauncher');
    if (isWindows) {
        modulePath = modulePath.replace(/\\/g, '\\\\');
    }
    const shellArgs = [
        process.argv0,
        '-e',
        `require('${modulePath}').main()`
    ]
    if (isWindows) {
        shellArgs.shift();
    }
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
    reporter.sendTelemetryEvent('spotConnect/initiate');
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            try {
                let stdout = cp.execSync('node.exe --version').toString();
                const version = stdout[0] === 'v' && stdout.substr(1).trim();
                if (version && semver.valid(version) && !semver.gte(version, '6.0.0')) {
                    throw new Error('Bad node version');
                }
            } catch (err) {
                console.log(err);
                const open: MessageItem = { title: "Download Node.js" };
                const message = "Opening a Spot currently requires Node.js 6 or later to be installed (https://nodejs.org) on Windows.";
                window.showInformationMessage(message, open)
                .then((msgItem: MessageItem | undefined) => {
                    if (msgItem === open) {
                        opn('https://nodejs.org');
                    }
                });
                reporter.sendTelemetryEvent('spotConnect/conclude',
                                            {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                            'spot.reason': 'WINDOWS_REQUIRE_NODE'});
                return;
            }
        }
        spotHealthCheck(hostname, token)
        .then(() => {
            activeSession = new SpotSession(hostname, token);
            spotFileTracker.connect(activeSession);
            createSpotConsole(activeSession).then(() => {
                commands.executeCommand('setContext', 'canShowSpotExplorer', true);
                window.showInformationMessage(`Connected to ${hostname}`);
                updateStatusBar(`${hostname} (connected)`);
                reporter.sendTelemetryEvent('spotConnect/conclude',
                                            {'spot.result': TelemetryResult.SUCCESS});
                resolve();
            }).catch(() => {
                activeSession = null;
                commands.executeCommand('setContext', 'canShowSpotExplorer', false);
                console.error('An error occurred whilst creating spot console.');
                reporter.sendTelemetryEvent('spotConnect/conclude',
                                            {'spot.result': TelemetryResult.ERROR,
                                            'spot.reason': 'CONSOLE_LAUNCH_FAILURE'});
                reject();
            });
        })
        .catch((err) => {
            activeSession = null;
            commands.executeCommand('setContext', 'canShowSpotExplorer', false);
            window.showErrorMessage(`Failed to connect to ${hostname}`);
            updateStatusBar('Not connected');
            statusBarItem.show();
            reporter.sendTelemetryEvent('spotConnect/conclude',
                                            {'spot.result': TelemetryResult.ERROR,
                                            'spot.reason': 'HEALTH_CHECK_FAILURE'});
            reject();
        });
    });
}

function cmdSpotConnect() {
    reporter.sendTelemetryEvent('onCommand/spotConnect');
    const spotNamePrompt = Object.keys(knownSpots.getAll()).length > 0 ? `Known spots: ${Array.from(Object.keys(knownSpots.getAll()))}` : undefined;
    window.showInputBox({placeHolder: 'Spot to connect to.', ignoreFocusOut: true, prompt: spotNamePrompt}).then((spotName) => {
        if (!spotName) {
            return;
        }
        if (knownSpots.isKnown(spotName)) {
            const spot = knownSpots.get(spotName);
            connectToSpot(spot.hostname, spot.instanceToken);
        } else {
            if (spotName.indexOf('azurecontainer.io') > -1 && spotName.indexOf('?token=') > -1) {
                // If full URL provided, no need to ask for token
                const spotURL = new URL(spotName);
                const spotPort = spotURL.protocol.startsWith('https') ? '443' : '80';
                var spotToken = spotName.substring(spotName.indexOf('?token=') + '?token='.length);
                spotName = `${spotURL.origin}:${spotPort}`;
                connectToSpot(spotName, spotToken);
                return;
            }
            window.showInputBox({placeHolder: 'Token for the spot.', password: true, ignoreFocusOut: true}).then((spotToken) => {
                if (spotToken) {
                    connectToSpot(spotName!, spotToken);
                }
            });
        }
    });
}

function cmdSpotDisconnect() {
    reporter.sendTelemetryEvent('onCommand/spotDisconnect');
    disconnectFromSpot(activeSession);
}

function disconnectFromSpot(session: SpotSession | null) {
    reporter.sendTelemetryEvent('spotDisconnect/initiate');
    if (activeSession != null) {
        // Check if there are any unsaved files from the spot
        for (var te of window.visibleTextEditors) {
            if (te.document.isDirty && te.document.fileName.indexOf('_spot') > -1) {
                window.showWarningMessage('Please save unsaved files in spot.');
                reporter.sendTelemetryEvent('spotDisconnect/conclude',
                                            {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                            'spot.reason': 'UNSAVED_FILES'});
                return;
            }
        }
        spotFileTracker.disconnect();
        ipcQueue.push({ type: 'exit' });
        commands.executeCommand('setContext', 'canShowSpotExplorer', false);
        if (activeSession.hostname.indexOf('azurecontainer.io') > -1) {
            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
            const terminateMsgItem: MessageItem = {title: 'Terminate'};
            window.showInformationMessage('Disconnected from spot. Remember to review your currently running Azure spots to prevent unexpected charges.', portalMsgItem, terminateMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (portalMsgItem === msgItem) {
                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                } else if (terminateMsgItem === msgItem) {
                    terminateSpot();
                }
            });
        } else {
            window.showInformationMessage('Disconnected from spot.');
        }
    } else {
        window.showInformationMessage('Not currently connected to a spot.');
    }
    activeSession = null;
    updateStatusBar('Not connected');
    reporter.sendTelemetryEvent('spotDisconnect/conclude', {'spot.result': TelemetryResult.SUCCESS});
}

function cmdSpotTerminate() {
    reporter.sendTelemetryEvent('onCommand/spotTerminate');
    if (activeSession != null) {
        const disConnectMsgItem: MessageItem = {title: 'Disconnect'};
        window.showWarningMessage('Disconnect from the current spot before terminating a spot.', disConnectMsgItem)
        .then((msgItem: MessageItem | undefined) => {
            if (disConnectMsgItem === msgItem) {
                disconnectFromSpot(activeSession);
            }
        });
    } else {
        terminateSpot();
    }
}

function terminateSpot() {
    reporter.sendTelemetryEvent('spotTerminate/initiate');
    const azureSub = getAzureSubscription();
    if (!azureSub) {
        reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                     'spot.reason': 'NO_AZURE_SUBSCRIPTION'});
        return;
    }
    const spotNamePrompt = Object.keys(knownSpots.getAll()).length > 0 ? `Known spots: ${Array.from(Object.keys(knownSpots.getAll()))}` : undefined;
    window.showInputBox({placeHolder: 'Name of spot to terminate/delete.', ignoreFocusOut: true, prompt: spotNamePrompt}).then((spotName) => {
        if (spotName) {
            const confirmYesMsgItem = {title: 'Yes'};
            const confirmNoMsgItem = {title: 'No'};
            window.showWarningMessage(`Are you sure you want to delete the spot ${spotName}`, confirmYesMsgItem, confirmNoMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (msgItem === confirmYesMsgItem) {
                        console.log(`Attempting to terminate spot ${spotName}`);
                        window.showInformationMessage(`Attempting to terminate spot ${spotName}`);
                        const rmClient = new ResourceManagementClient(azureSub.session.credentials, azureSub.subscription.subscriptionId!);
                        const resourceGroupName = workspace.getConfiguration('spot').get<string>('azureResourceGroup');
                        if (!resourceGroupName) {
                            const moreInfoItem: MessageItem = {title: 'More Info'};
                            window.showErrorMessage('Please set up the resource group in the configuration.', moreInfoItem)
                            .then((msgItem: MessageItem | undefined) => {
                                if (msgItem === moreInfoItem) {
                                    opn('https://github.com/derekbekoe/vscode-spot#configuration');
                                }
                            });
                            reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'MISSING_CONFIGURATION_VARIABLES'});
                            return;
                        }
                        rmClient.resources.deleteMethod(resourceGroupName, "Microsoft.ContainerInstance", "",
                                                        "containerGroups", spotName, "2018-04-01")
                        .then(() => {
                            console.log('Spot deleted');
                            window.showInformationMessage('Spot terminated!');
                            reporter.sendTelemetryEvent('spotTerminate/conclude',
                            {'spot.result': TelemetryResult.SUCCESS});
                            knownSpots.remove(spotName);
                        })
                        .catch(() => {
                            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
                            reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                     'spot.reason': 'ARM_RESOURCE_DELETE_FAILURE'});
                            window.showErrorMessage('Unable to terminate spot. Open the Azure portal and delete the container group from there.', portalMsgItem)
                            .then((msgItem: MessageItem | undefined) => {
                                if (portalMsgItem === msgItem) {
                                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                                }
                            });
                        });
                    } else {
                        console.log('User cancelled spot delete operation.');
                        reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'USER_CANCELLED'});
                    }
                });
        }
        });
}

export function deactivate() {
    reporter.dispose();
}
