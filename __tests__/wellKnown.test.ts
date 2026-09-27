//
// target: __tests__/wellKnown.test.ts
//
// The two files that let the OS open the app for a tag link (ONE-31): Apple's
// apple-app-site-association and Google's assetlinks.json, committed under
// public/.well-known/ for the tag host to serve. Both platforms ignore a wrong
// file without a word, so the shape is pinned here.
//
// The Apple Team ID and the signing-certificate fingerprints come from the
// owner's Apple and Google accounts, and stay placeholders until they are
// filled in. A placeholder passes. Anything else must have the real shape.

import * as fs from 'fs';
import * as path from 'path';
import { TAG_PATH_PREFIX } from '../lib/tagLinks';

const WELL_KNOWN = path.join(__dirname, '..', 'public', '.well-known');

const readJson = (name: string) => JSON.parse(fs.readFileSync(path.join(WELL_KNOWN, name), 'utf8'));

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Placeholders standing in for identifiers from the owner's accounts. */
const APPLE_TEAM_ID_PLACEHOLDER = 'APPLE_TEAM_ID';
const FINGERPRINT_PLACEHOLDERS = ['PLAY_APP_SIGNING_KEY_SHA256', 'EAS_UPLOAD_KEY_SHA256'];

/** 32 bytes, as colon-separated upper-case hex: the form `keytool` and Play Console print. */
const SHA256_FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

describe('public/.well-known', () => {
  it('holds the two files, the AASA with no extension', () => {
    expect(fs.readdirSync(WELL_KNOWN).sort()).toEqual(['apple-app-site-association', 'assetlinks.json']);
  });
});

describe('apple-app-site-association', () => {
  const details: { appIDs: string[]; components: Record<string, string>[] }[] =
    readJson('apple-app-site-association').applinks.details;

  it('names the app as <Team ID>.<bundle identifier>', () => {
    const appId = new RegExp(
      `^(?:${APPLE_TEAM_ID_PLACEHOLDER}|[A-Z0-9]{10})\\.${escapeRegExp(appJson.ios.bundleIdentifier)}$`,
    );
    const appIds = details.flatMap((detail) => detail.appIDs);
    expect(appIds.length).toBeGreaterThan(0);
    for (const id of appIds) expect(id).toMatch(appId);
  });

  it('opens the app for /t/* and nothing else on the host', () => {
    const paths = details.flatMap((detail) => detail.components.map((component) => component['/']));
    expect(paths).toEqual([`/${TAG_PATH_PREFIX}/*`]);
  });
});

describe('assetlinks.json', () => {
  const statements: {
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }[] = readJson('assetlinks.json');

  it("names the Android package, with permission to handle the links it declares", () => {
    expect(statements).toHaveLength(1);
    expect(statements[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statements[0].target.namespace).toBe('android_app');
    expect(statements[0].target.package_name).toBe(appJson.android.package);
  });

  it('lists SHA-256 signing-certificate fingerprints, or their placeholders', () => {
    const fingerprints = statements[0].target.sha256_cert_fingerprints;
    expect(fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of fingerprints) {
      if (!FINGERPRINT_PLACEHOLDERS.includes(fingerprint)) expect(fingerprint).toMatch(SHA256_FINGERPRINT);
    }
  });
});
