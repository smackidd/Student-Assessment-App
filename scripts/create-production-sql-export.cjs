const path = require("node:path");

const firebaseToolsRoot = path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib");
const auth = require(path.join(firebaseToolsRoot, "auth"));
const { Client } = require(path.join(firebaseToolsRoot, "apiv2"));

const projectId = "student-assessment-2d869";
const instanceId = "student-assessment-db";
const databaseId = "student_assessment";
const bucket = "student-assessment-2d869.firebasestorage.app";
const confirmProject = argumentValue("--confirm-project");
const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const objectName = `database-backups/pre-production-student-purge-${timestamp}.sql.gz`;
const uri = `gs://${bucket}/${objectName}`;

if (apply && (!allowProduction || confirmProject !== projectId)) {
  throw new Error(`Production export requires --allow-production --confirm-project ${projectId}.`);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function responseBody(response) {
  return response && Object.prototype.hasOwnProperty.call(response, "body") ? response.body : response;
}

function unconditionalBinding(policy, role) {
  return (policy.bindings || []).find((binding) => binding.role === role && !binding.condition);
}

function addMember(policy, role, member) {
  let binding = unconditionalBinding(policy, role);
  if (!binding) {
    binding = { role, members: [] };
    policy.bindings = [...(policy.bindings || []), binding];
  }
  const existed = binding.members.includes(member);
  if (!existed) binding.members.push(member);
  return !existed;
}

function removeMember(policy, role, member) {
  const binding = unconditionalBinding(policy, role);
  if (!binding) return;
  binding.members = binding.members.filter((candidate) => candidate !== member);
  if (!binding.members.length) policy.bindings = policy.bindings.filter((candidate) => candidate !== binding);
}

async function waitForOperation(sql, operationName) {
  const operationId = String(operationName).split("/").pop();
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const operation = responseBody(await sql.get(`/projects/${projectId}/operations/${operationId}`));
    if (operation.status === "DONE") {
      if (operation.error) throw new Error(`SQL export failed: ${JSON.stringify(operation.error)}`);
      return operationId;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Timed out waiting for the production SQL export.");
}

async function run() {
  const selectedAccount = auth.selectAccount("stevemackidd@gmail.com", process.cwd());
  if (!selectedAccount) throw new Error("Firebase account stevemackidd@gmail.com is not logged in.");
  auth.setActiveAccount({ project: projectId, nonInteractive: true }, selectedAccount);

  const sql = new Client({ urlPrefix: "https://sqladmin.googleapis.com", apiVersion: "v1" });
  const storage = new Client({ urlPrefix: "https://storage.googleapis.com/storage/v1" });
  const instance = responseBody(await sql.get(`/projects/${projectId}/instances/${instanceId}`));
  if (instance.state !== "RUNNABLE") throw new Error(`Production SQL instance is ${instance.state}, not RUNNABLE.`);
  const serviceMember = `serviceAccount:${instance.serviceAccountEmailAddress}`;
  console.log(JSON.stringify({ projectId, instanceId, databaseId, state: instance.state, plannedUri: uri, mode: apply ? "apply" : "dry-run" }, null, 2));
  if (!apply) return;

  const policyPath = `/b/${encodeURIComponent(bucket)}/iam`;
  let memberAdded = false;
  let cleanupError;
  try {
    const policy = responseBody(await storage.get(policyPath));
    memberAdded = addMember(policy, "roles/storage.objectAdmin", serviceMember);
    if (memberAdded) await storage.put(policyPath, policy);
    const exportResponse = responseBody(await sql.post(`/projects/${projectId}/instances/${instanceId}/export`, {
      exportContext: { fileType: "SQL", uri, databases: [databaseId], offload: false }
    }));
    const operationId = await waitForOperation(sql, exportResponse.name);
    const metadata = responseBody(await storage.get(`/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`));
    console.log(JSON.stringify({
      status: "backup-created-and-verified",
      operationId,
      uri,
      sizeBytes: Number(metadata.size),
      generation: String(metadata.generation),
      crc32c: metadata.crc32c || null,
      created: metadata.timeCreated || null
    }, null, 2));
  } finally {
    if (memberAdded) {
      try {
        const latestPolicy = responseBody(await storage.get(policyPath));
        removeMember(latestPolicy, "roles/storage.objectAdmin", serviceMember);
        await storage.put(policyPath, latestPolicy);
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError) throw new Error(`Backup succeeded, but temporary bucket permission cleanup failed: ${cleanupError.message}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
