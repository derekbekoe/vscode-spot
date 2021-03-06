import * as appInsights from 'applicationinsights';
import * as os from 'os';
import * as vscode from 'vscode';

// Adapted from https://github.com/Microsoft/vscode-extension-telemetry/blob/master/src/telemetryReporter.ts

// tslint:disable-next-line:no-string-literal
process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'] = '1';

export class TelemetryReporter extends vscode.Disposable {

    private static TELEMETRY_CONFIG_ID = 'telemetry';
    private static TELEMETRY_CONFIG_ENABLED_ID = 'enableTelemetry';

    private appInsightsClient: appInsights.TelemetryClient | undefined;
    private userOptIn: boolean = true;
    private toDispose: vscode.Disposable[] = [];

    constructor(private extensionId: string, private extensionVersion: string, key: string) {
        super(() => this.toDispose.forEach((d) => d && d.dispose()));

        // check if another instance is already initialized
        if (appInsights.defaultClient) {
            this.appInsightsClient = new appInsights.TelemetryClient(key);
            // no other way to enable offline mode
            this.appInsightsClient.channel.setUseDiskRetryCaching(true);
        } else {
            appInsights.setup(key)
                .setAutoCollectRequests(false)
                .setAutoCollectPerformance(false)
                .setAutoCollectExceptions(false)
                .setAutoCollectDependencies(false)
                .setAutoDependencyCorrelation(false)
                .setAutoCollectConsole(false)
                .setUseDiskRetryCaching(true)
                .start();
            this.appInsightsClient = appInsights.defaultClient;
        }
        if (vscode && vscode.env) {
            this.appInsightsClient.context.tags[this.appInsightsClient.context.keys.userId] = vscode.env.machineId;
            this.appInsightsClient.context.tags[this.appInsightsClient.context.keys.sessionId] = vscode.env.sessionId;
            // tslint:disable-next-line:max-line-length
            this.appInsightsClient.context.tags[this.appInsightsClient.context.keys.applicationVersion] = this.extensionVersion;
        }
        this.appInsightsClient.commonProperties = this.getCommonProperties();
        this.updateUserOptIn();
        this.toDispose.push(vscode.workspace.onDidChangeConfiguration(() => this.updateUserOptIn()));
    }

    public sendTelemetryEvent(eventName: string,
                              properties?: { [key: string]: string },
                              measures?: { [key: string]: number }): void {
        if (this.userOptIn && eventName && this.appInsightsClient) {
            this.appInsightsClient.trackEvent({
                measurements: measures,
                name: `${this.extensionId}/${eventName}`,
                properties: properties
            });
        }
    }

    public dispose(): Promise<any> {
        return new Promise<any>((resolve) => {
            if (this.appInsightsClient) {
                this.appInsightsClient.flush({
                    callback: () => {
                        // all data flushed
                        this.appInsightsClient = undefined;
                        resolve(void 0);
                    }
                });
            } else {
                resolve(void 0);
            }
        });
    }

    private updateUserOptIn(): void {
        const config = vscode.workspace.getConfiguration(TelemetryReporter.TELEMETRY_CONFIG_ID);
        this.userOptIn = config.get<boolean>(TelemetryReporter.TELEMETRY_CONFIG_ENABLED_ID, true);
    }

   private getCommonProperties(): { [key: string]: string } {
        const commonProperties = Object.create(null);
        commonProperties['common.os'] = os.platform();
        commonProperties['common.platformversion'] = (os.release() || '').replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/,
                                                                                  '$1$2$3');
        commonProperties['common.extname'] = this.extensionId;
        commonProperties['common.extversion'] = this.extensionVersion;
        if (vscode && vscode.env) {
            commonProperties['common.vscodemachineid'] = vscode.env.machineId;
            commonProperties['common.vscodesessionid'] = vscode.env.sessionId;
            commonProperties['common.vscodeversion'] = vscode.version;
        }
        return commonProperties;
    }
}

export function createTelemetryReporter(context: vscode.ExtensionContext) {
    const extensionPackage = require(context.asAbsolutePath("./package.json"));
    const reporter = new TelemetryReporter(extensionPackage.name, extensionPackage.version, extensionPackage.aiKey);
    context.subscriptions.push(reporter);
    return reporter;
}

export enum TelemetryResult {
    SUCCESS = "SUCCESS",
    ERROR = "ERROR",
    USER_RECOVERABLE = "USER_RECOVERABLE"
}
