import { Client } from 'ssh2';
import { exec as execCallback } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import type { HostConfig } from './types';

const execAsync = promisify(execCallback);

const DEFAULT_SSH_TIMEOUT = 15_000;
const DEFAULT_KEY_PATH = path.join(os.homedir(), '.ssh', 'id_ed25519');

function expandTilde(filePath?: string) {
  if (!filePath) {
    return undefined;
  }
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function buildSshOptions(host: HostConfig) {
  if (host.connection.type !== 'ssh') {
    throw new Error(`Host ${host.id} is not configured for SSH`);
  }

  const privateKeyPath =
    expandTilde(host.connection.privateKeyPath) ?? DEFAULT_KEY_PATH;

  return {
    host: host.connection.host,
    port: host.connection.port ?? 22,
    username: host.connection.username,
    readyTimeout: host.connection.readyTimeoutMs ?? DEFAULT_SSH_TIMEOUT,
    privateKey: fs.existsSync(privateKeyPath)
      ? fs.readFileSync(privateKeyPath, 'utf-8')
      : undefined,
    agent: process.env.SSH_AUTH_SOCK,
  };
}

function wrapRemoteCommand(command: string) {
  const escaped = command.replace(/"/g, '\\"');
  return `bash -lc "${escaped}"`;
}

export async function runCommand(host: HostConfig, command: string) {
  if (host.connection.type === 'local') {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  }

  const sshOptions = buildSshOptions(host);

  return new Promise<string>((resolve, reject) => {
    const client = new Client();

    client
      .on('ready', () => {
        client.exec(wrapRemoteCommand(command), (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream
            .on('close', (code: number | null) => {
              client.end();
              if (code && code !== 0) {
                reject(
                  new Error(
                    `Remote command failed with code ${code}: ${stderr.trim()}`,
                  ),
                );
              } else {
                resolve(stdout.trim());
              }
            })
            .on('data', (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
        });
      })
      .on('error', (err) => {
        reject(err);
      })
      .connect(sshOptions);
  });
}
