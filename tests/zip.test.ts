import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../src/core/zip.ts';

test('createZip writes a valid archive readable by unzip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-zip-'));
  const buf = createZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<container/>' },
    { name: 'big.txt', data: 'hello world '.repeat(200) },
  ]);
  const file = join(dir, 'test.zip');
  writeFileSync(file, buf);
  // EOCD signature and entry count
  const eocdOffset = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocdOffset), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocdOffset + 10), 3);
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
  // first entry is the stored mimetype
  assert.equal(buf.subarray(30, 38).toString('latin1'), 'mimetype');
  assert.equal(buf.readUInt16LE(8), 0); // method 0 = stored
  // unzip -t verifies CRCs end-to-end
  const output = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
  assert.match(output, /No errors detected/);
  const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
  assert.match(list, /container\.xml/);
  assert.match(list, /big\.txt/);
});

test('empty archives are valid', () => {
  const buf = createZip([]);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(existsSync('/nonexistent-xyz'), false);
});
