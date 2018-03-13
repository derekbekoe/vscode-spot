import { window, Uri, workspace, TextDocumentWillSaveEvent, EventEmitter, Event, TextDocumentSaveReason } from 'vscode';
import { SpotSession } from './session';
import { URL } from 'url';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as WS from 'ws';
import * as tmp from 'tmp';

export class SpotFile {
    constructor(public isDirectory: boolean, public path: string, public spotSession: SpotSession, public children: Map<string, SpotFile>=new Map<string, SpotFile>()) {}
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
            var new_node = new SpotFile(obj_data.event === 'addDir', obj_data.path, session);
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
        this.files = new Map<string, SpotFile>();
        this.onFilesChangedEmitter.fire(this.files);
        if (this.ws) {
          this.ws.terminate();
        }
      }
}

function ensureDirectoryExistence(filePath: string) {
  var dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

var tmpobj = tmp.dirSync();

export function openFileEditor(documentPath: any, session: SpotSession) {
  const storagePath: string = tmpobj.name;
  const tmpDirName: string = '_spot';
  if (!session) {
    console.error("Unable to open file editor. Session not set.");
    return;
  }
  const url = new URL(session.hostname);
  const socketProtocol = url.protocol === 'https' ? 'wss' : 'ws';
  const fileId = createHash('md5').update(documentPath).digest('hex');
  const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/file/${fileId}/?token=${session.token}`;
  // TODO For security reasons, don't do rejectUnauthorized
  const ws = new WS(socketUri, {rejectUnauthorized: false});
  ws.on('open', () => {
    var data = {'event': 'fileDownload', 'path': documentPath};
    ws!.send(JSON.stringify(data));
  });
  ws.on('message', (data:  Buffer) => {
    if (!storagePath) {
      console.error('storagePath is undefined!');
      return;
    }
    const tmpPath = path.join(storagePath, tmpDirName, documentPath);
    ensureDirectoryExistence(tmpPath);
    fs.writeFile(tmpPath, data, (err) => {
      if (err) {
        console.error("Error writing file", err);
      } else {
        let uriDocBookmark: Uri = Uri.file(tmpPath);
        workspace.openTextDocument(uriDocBookmark).then(doc => {
            window.showTextDocument(doc);
        });
        workspace.onWillSaveTextDocument((e: TextDocumentWillSaveEvent) => {
            if (e.document.fileName === tmpPath && e.reason === TextDocumentSaveReason.Manual) {
              ws.send(e.document.getText());
            }
        });
      }
    });
  });
  ws.on('error', (event) => {
    console.error('Socket error: ' + JSON.stringify(event));
  });
  ws.on('close', () => {
    console.log('Socket closed');
  });
}
