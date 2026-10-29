const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  yaml = require("yaml");
test("native verification workflows are valid build-only PR workflows", () => {
  for (const name of ["verify.yml", "native-verify.yml"]) {
    const raw = fs.readFileSync(
        path.join(__dirname, "../.github/workflows", name),
        "utf8",
      ),
      w = yaml.parse(raw);
    assert.ok(w.on.pull_request !== undefined);
    assert.equal(w.permissions.contents, "read");
    assert.ok(!/gh release create|deploy-pages|contents:\s*write/.test(raw));
  }
  const native = yaml.parse(
    fs.readFileSync(
      path.join(__dirname, "../.github/workflows/native-verify.yml"),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(native.jobs).sort(), [
    "android",
    "ios",
    "windows",
  ]);
  assert.ok(
    native.jobs.windows.steps.some((s) => s.run?.includes("--publish never")),
  );
});

test("publishing is manual, opt-in and restricted to main", () => {
  for (const name of ["pages.yml", "android.yml", "desktop.yml"]) {
    const workflow = yaml.parse(
      fs.readFileSync(
        path.join(__dirname, "../.github/workflows", name),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
    assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, "boolean");
    assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
    const gates =
      name === "pages.yml"
        ? [workflow.jobs.deploy.if]
        : Object.values(workflow.jobs).flatMap((job) =>
            job.steps
              .filter((step) => step.run?.includes("gh release create"))
              .map((step) => step.if),
          );
    assert.ok(gates.length > 0);
    for (const gate of gates) {
      assert.match(gate, /inputs\.publish/);
      assert.match(gate, /refs\/heads\/main/);
    }
  }
});
