import { window, Uri, workspace, TextDocumentWillSaveEvent, EventEmitter, Event, TextDocumentSaveReason } from 'vscode';
import { SpotSession, ensureDirectoryExistence, getWsProtocol } from './spotUtil';
import { URL } from 'url';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as WS from 'ws';
import * as tmp from 'tmp';
import * as rimraf from 'rimraf';

export class SpotFile {
    constructor(public isDirectory: boolean,
                public path: string,
                public spotSession: SpotSession,
                public children: Map<string, SpotFile>=new Map<string, SpotFile>()) {}
}

export class SpotFileTracker {

  private ws: WS | undefined;
  public files: Map<string, SpotFile> = new Map<string, SpotFile>();

  private onFilesChangedEmitter = new EventEmitter<Map<string, SpotFile>>();
  get onFilesChanged(): Event<Map<string, SpotFile>> {return this.onFilesChangedEmitter.event; }

  constructor(){}

  private addFileOrDir(isDirectory: boolean, path: string, session: SpotSession) {
    var new_node = new SpotFile(isDirectory, path, session);
    const segments: string[] = path.split('/').slice(1);
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
  }

  public connect(session: SpotSession) {
    const url = new URL(session.hostname);
    const socketProtocol = getWsProtocol(url);
    const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/files/?token=${session.token}`;
    var handledRootDir: boolean = false;
    this.files = new Map<string, SpotFile>();
    this.onFilesChangedEmitter.fire(this.files);
    this.ws = new WS(socketUri);
    this.ws.on('open', function () {
      console.log('socket open');
      handledRootDir = false;
    });
  
    this.ws.on('message', (data: string) => {
      console.log('socket data', data);
      const obj_data = JSON.parse(data);
      if (obj_data.event === 'addDir'  || obj_data.event === 'add') {
        if (obj_data.event === 'addDir' && !handledRootDir) {
          handledRootDir = true;
          var segments: string[] = obj_data.path.split('/');
          for (var i=1; i<=segments.length; i++) {
            var s: string = segments.slice(0, i).join('/');
            this.addFileOrDir(true, s, session);
          }
        } else {
          this.addFileOrDir(obj_data.event === 'addDir', obj_data.path, session);
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
    // Delete the directory on disconnect.
    if (tmpobj) {
      const dirname = path.join(tmpobj.name, '_spot');
      rimraf.sync(dirname);
    }
  }
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
  const socketProtocol = getWsProtocol(url);
  const fileId = createHash('md5').update(documentPath).digest('hex');
  const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/file/${fileId}/?token=${session.token}`;
  const ws = new WS(socketUri);
  ws.on('open', () => {
    var data = {'event': 'fileDownload', 'path': documentPath};
    ws!.send(JSON.stringify(data));
  });
  ws.on('message', (data: Buffer) => {
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
            } else if (process.platform === 'win32') {
              // Capitalize the drive letter to match tmp path and try again.
              let docFileName = e.document.fileName;
              docFileName = docFileName.charAt(0).toUpperCase() + docFileName.slice(1);
              if (docFileName === tmpPath && e.reason === TextDocumentSaveReason.Manual) {
                ws.send(e.document.getText());
              }
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
