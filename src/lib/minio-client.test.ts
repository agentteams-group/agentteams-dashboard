import { beforeEach, describe, expect, it, vi } from 'vitest';

// pickBackendUrl hits the F1 backend-config store (file-backed); the unit
// under test only consumes its return value, so mock it at the boundary.
vi.mock('./backend-config', () => ({
  pickBackendUrl: vi.fn(() => null),
}));

import { pickBackendUrl } from './backend-config';
import {
  createMinioClient,
  getMinioBucket,
  getMinioConfigFromEnv,
} from './minio-client';

const mockedPick = vi.mocked(pickBackendUrl);

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

beforeEach(() => {
  mockedPick.mockReset();
  mockedPick.mockReturnValue(null);
});

describe('getMinioConfigFromEnv', () => {
  it('returns null when any of endpoint/access/secret is missing', () => {
    withEnv({}, () => {
      expect(getMinioConfigFromEnv()).toBeNull();
    });
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'minio:9000',
      AGENTTEAMS_MINIO_USER: 'u',
    }, () => {
      expect(getMinioConfigFromEnv()).toBeNull();
    });
  });

  it('parses host/port/useSSL from an explicit URL', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'https://minio.example.com:9443',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({
        endPoint: 'minio.example.com',
        port: 9443,
        useSSL: true,
        accessKey: 'u',
        secretKey: 'p',
      });
    });
  });

  it('defaults the port by scheme and assumes http for bare hosts', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'minio.internal',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ endPoint: 'minio.internal', port: 80, useSSL: false });
    });
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'https://minio.internal',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ port: 443, useSSL: true });
    });
  });

  it('prefers the F1 backend URL over the legacy env vars', () => {
    mockedPick.mockReturnValue('https://f1-minio.example.com:9001');
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'legacy:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ endPoint: 'f1-minio.example.com', port: 9001 });
    });
  });

  it('maps a localhost endpoint to the controller host when advertised', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
      AGENTTEAMS_CONTROLLER_URL: 'https://controller.example.com',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ endPoint: 'controller.example.com', port: 9000, useSSL: false });
    });
  });

  it('keeps localhost when no controller URL is available', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'http://localhost:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ endPoint: 'localhost', port: 9000 });
    });
  });

  it('ignores a controller URL that is itself localhost', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'http://localhost:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
      AGENTTEAMS_CONTROLLER_URL: 'http://127.0.0.1:8080',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ endPoint: 'localhost' });
    });
  });

  it('defaults the region and honors AGENTTEAMS_FS_REGION', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'minio:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ region: 'us-east-1' });
    });
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'minio:9000',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
      AGENTTEAMS_FS_REGION: 'cn-north-1',
    }, () => {
      expect(getMinioConfigFromEnv()).toMatchObject({ region: 'cn-north-1' });
    });
  });
});

describe('getMinioBucket', () => {
  it('prefers AGENTTEAMS_FS_BUCKET and returns null when unset', () => {
    withEnv({ AGENTTEAMS_FS_BUCKET: 'fs-bucket', AGENTTEAMS_MINIO_BUCKET: 'legacy' }, () => {
      expect(getMinioBucket()).toBe('fs-bucket');
    });
    withEnv({ AGENTTEAMS_FS_BUCKET: undefined, AGENTTEAMS_MINIO_BUCKET: 'legacy' }, () => {
      expect(getMinioBucket()).toBe('legacy');
    });
    withEnv({ AGENTTEAMS_FS_BUCKET: undefined, AGENTTEAMS_MINIO_BUCKET: undefined }, () => {
      expect(getMinioBucket()).toBeNull();
    });
  });
});

describe('createMinioClient', () => {
  it('fails closed with a config error when nothing is configured', () => {
    withEnv({}, () => {
      expect(() => createMinioClient()).toThrow(/MinIO is not configured/);
    });
  });

  it('builds a client from an explicit config without touching env', () => {
    withEnv({}, () => {
      const client = createMinioClient({
        endPoint: 'minio.example.com',
        port: 9000,
        useSSL: false,
        accessKey: 'ak',
        secretKey: 'sk',
      });
      expect(client).toBeTruthy();
      expect(typeof client.listBuckets).toBe('function');
    });
  });

  it('builds a client from env when no config is passed', () => {
    withEnv({
      AGENTTEAMS_MINIO_ENDPOINT: 'https://minio.example.com',
      AGENTTEAMS_MINIO_USER: 'u',
      AGENTTEAMS_MINIO_PASSWORD: 'p',
    }, () => {
      expect(createMinioClient()).toBeTruthy();
    });
  });
});
