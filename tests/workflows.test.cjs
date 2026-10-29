const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  yaml = require('yaml');
test('native verification workflows are valid build-only PR workflows', () => {
  for (const name of ['verify.yml', 'native-verify.yml']) {
    const raw = fs.readFileSync(
        path.join(__dirname, '../.github/workflows', name),
        'utf8'
      ),
      w = yaml.parse(raw);
    assert.ok(w.on.pull_request !== undefined);
    assert.equal(w.permissions.contents, 'read');
    assert.ok(!/gh release create|deploy-pages|contents:\s*write/.test(raw));
  }
  const native = yaml.parse(
    fs.readFileSync(
      path.join(__dirname, '../.github/workflows/native-verify.yml'),
      'utf8'
    )
  );
  assert.deepEqual(Object.keys(native.jobs).sort(), [
    'android',
    'ios',
    'windows'
  ]);
  assert.ok(
    native.jobs.windows.steps.some((s) => s.run?.includes('--publish never'))
  );
});
