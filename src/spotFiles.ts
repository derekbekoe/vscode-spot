import { window, Uri, workspace, TextDocumentWillSaveEvent, EventEmitter, Event } from 'vscode';
import { SpotSession } from './session';
import { URL } from 'url';
import * as WS from 'ws';

export class SpotFile {
    constructor(public isDirectory: boolean, public path: string, public children: Map<string, SpotFile>=new Map<string, SpotFile>()) {}
}

export class SpotFileTracker {

    private ws: WS | undefined;
    public files: Map<string, SpotFile> = new Map<string, SpotFile>();

    private onFilesChangedEmitter = new EventEmitter<Map<string, SpotFile>>();
    get onFilesChanged(): Event<Map<string, SpotFile>> {return this.onFilesChangedEmitter.event; }

    constructor(){}

    public connect(session: SpotSession) {
        const url = new URL(session.hostname);
        const socketProtocol = url.protocol === 'https' ? 'wss' : 'ws';
        const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/files/?token=${session.token}`;
          // TODO For security reasons, don't do rejectUnauthorized
        this.ws = new WS(socketUri, {rejectUnauthorized: false});
        this.ws.on('open', function () {
          console.log('socket open');
        });
      
        this.ws.on('message', (data: string) => {
          console.log('socket data', data);
          const obj_data = JSON.parse(data);
          if (obj_data.event === 'addDir' || obj_data.event === 'add') {
            var new_node = new SpotFile(obj_data.event === 'addDir', obj_data.path);
            const segments: string[] = obj_data.path.split('/').slice(1);
            var f_s = this.files;
            for (let segment of segments) {
              const segment_v = f_s.get(segment);
              if (segment_v) {
                f_s = segment_v.children;
              } else {
                f_s.set(segment, new_node);
                f_s = new_node.children;
              }
            }
          } else if (obj_data.event === 'unlinkDir' || obj_data.event === 'unlink') {
            const segments: string[] = obj_data.path.split('/').slice(1);
            var f_parent = this.files;
            for (let i = 0; i < segments.length-1; i++) {
              const segment_v = f_parent.get(segments[i]);
              if (segment_v) {
                f_parent = segment_v.children;
              }
            }
            f_parent.delete(segments[segments.length -1]);
          }
          this.onFilesChangedEmitter.fire(this.files);
        });
      
        this.ws.on('error', function (event) {
          console.error('Socket error: ' + JSON.stringify(event));
        });
      
        this.ws.on('close', function () {
          console.log('Socket closed');
        });
      }
    
      public disconnect() {
        console.log(this.files);
        if (this.ws) {
          this.ws.terminate();
        }
      }

}

export function openFileEditor(documentPath: any) {
        // TODO Save a temp copy of the file locally and open then track changes
        // let uriDocBookmark: Uri = Uri.parse('spot://'+documentPath);
        let uriDocBookmark: Uri = Uri.file(documentPath);
        workspace.openTextDocument(uriDocBookmark).then(doc => {
            window.showTextDocument(doc);
        });
        workspace.onWillSaveTextDocument((e: TextDocumentWillSaveEvent) => {
            // TODO Save to server with websocket
            console.log(e.document);
            console.log(e.reason);
        });
}

