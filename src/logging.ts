
import { OutputChannel, window } from 'vscode';

export class SpotLog {
    public static readonly ConsoleId = '[Spot]';
    public static outputChannel: OutputChannel | undefined;

    public static configureOutputChannel() {
        this.outputChannel = this.outputChannel || window.createOutputChannel('Spot');
    }

    public static log(message?: any, ...params: any[]): void {
        console.log(this.timestamp, SpotLog.ConsoleId, message, ...params);
        if (this.outputChannel !== undefined) {
            this.outputChannel.appendLine([this.timestamp, '[log]', message, ...params].join(' '));
        }
    }

    public static error(message?: any, ...params: any[]): void {
        console.error(this.timestamp, SpotLog.ConsoleId, message, ...params);
        if (this.outputChannel !== undefined) {
            this.outputChannel.appendLine([this.timestamp, '[error]', message, ...params].join(' '));
        }
    }

    public static showOutputChannel() {
        if (this.outputChannel !== undefined) {
            this.outputChannel.show();
        }
    }

    private static get timestamp(): string {
        const dateNow = new Date();
        return `[${dateNow.toISOString}]`;
    }
}
