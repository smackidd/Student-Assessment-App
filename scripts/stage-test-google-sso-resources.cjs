const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const PROJECT = "student-assessment-test";
const baseSession = "auth.token.authMethod == 'google' && auth.token.firebase.sign_in_provider == 'google.com' && auth.token.email_verified == true && auth.token.email == auth.token.invitedEmail";

function approvedEmail(value = "") {
  const email = value.trim().toLowerCase();
  if (email && (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email) || email.endsWith("@foothillsacademy.org"))) {
    throw new Error("Supply one exact outside email address, or leave the exception empty.");
  }
  return email;
}

function strengthenConnector(source, externalEmail = "") {
  const exception = approvedEmail(externalEmail);
  const allowedIdentity = "auth.token.email.matches('^[^@]+@foothillsacademy[.]org$')" + (exception ? " || auth.token.email == " + JSON.stringify(exception) : "");
  let count = 0;
  const strengthened = source.replace(/@auth\(expr: "([^"\n]+)"\)/g, (match, expr) => {
    if (!expr.startsWith("auth.token.organizationId == 'student-assessment' && auth.token.role")) {
      throw new Error("Unexpected connector authorization expression; review it before staging.");
    }
    count++;
    return "@auth(expr: " + JSON.stringify(expr + " && " + baseSession + " && (" + allowedIdentity + ")") + ")";
  });
  return { source: strengthened, count };
}

function strengthenStorage(source, externalEmail = "") {
  const exception = approvedEmail(externalEmail);
  const allowed = "request.auth.token.email.lower().matches('^[^@]+@foothillsacademy[.]org$')" + (exception ? " || request.auth.token.email.lower() == " + JSON.stringify(exception) : "");
  const target = "return request.auth != null;";
  if (source.split(target).length !== 2) throw new Error("Unexpected Storage session gate; review it before staging.");
  return source.replace(target, () => "return request.auth != null\n        && request.auth.token.organizationId == 'student-assessment'\n        && request.auth.token.authMethod == 'google'\n        && request.auth.token.firebase.sign_in_provider == 'google.com'\n        && request.auth.token.email_verified == true\n        && request.auth.token.email.lower() == request.auth.token.invitedEmail\n        && (" + allowed + ");");
}

function strengthenFirestore(source, externalEmail = "") {
  const exception = approvedEmail(externalEmail);
  const allowed = "email().matches('^[^@]+@foothillsacademy[.]org$')" + (exception ? " || email() == " + JSON.stringify(exception) : "");
  const target = "&& email() == request.auth.token.invitedEmail;";
  if (source.split(target).length !== 2) throw new Error("Unexpected Firestore Google session gate; review it before staging.");
  return source.replace(target, () => "&& email() == request.auth.token.invitedEmail\n        && (" + allowed + ");");
}

function stage(project, externalEmail) {
  if (project !== PROJECT) throw new Error("This staging tool only supports student-assessment-test.");
  const appRoot = path.resolve(__dirname, "..");
  const workspace = path.resolve(appRoot, "..");
  const destination = path.join(appRoot, ".tmp", "google-sso-resources", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(workspace, "dataconnect"), path.join(destination, "dataconnect"), { recursive: true, filter: (source) => !source.includes(path.sep + ".dataconnect") && !source.includes(path.sep + "node_modules") });
  const evidence = { project, externalEmail: approvedEmail(externalEmail), connectorGuards: 0, files: {} };
  for (const name of ["queries.gql", "mutations.gql"]) {
    const file = path.join(destination, "dataconnect", "student-assessment", name);
    const before = fs.readFileSync(file, "utf8");
    const after = strengthenConnector(before, externalEmail);
    evidence.connectorGuards += after.count;
    fs.writeFileSync(file, after.source);
    evidence.files[name] = { before: crypto.createHash("sha256").update(before).digest("hex"), after: crypto.createHash("sha256").update(after.source).digest("hex") };
  }
  if (evidence.connectorGuards !== 4) throw new Error("Expected exactly four direct connector guards; review canonical operations.");
  fs.writeFileSync(path.join(destination, "storage.rules"), strengthenStorage(fs.readFileSync(path.join(workspace, "storage.rules"), "utf8"), externalEmail));
  fs.writeFileSync(path.join(destination, "firestore.rules"), strengthenFirestore(fs.readFileSync(path.join(appRoot, "firestore.rules"), "utf8"), externalEmail));
  fs.writeFileSync(path.join(destination, "firebase.json"), JSON.stringify({ dataconnect: { source: "dataconnect" }, storage: { rules: "storage.rules" }, firestore: { rules: "firestore.rules" } }, null, 2));
  fs.writeFileSync(path.join(destination, "evidence.json"), JSON.stringify(evidence, null, 2));
  return destination;
}

module.exports = { approvedEmail, strengthenConnector, strengthenStorage, strengthenFirestore, stage };
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = (key) => args[args.indexOf(key) + 1];
  if (!args.includes("--project")) throw new Error("Explicit --project student-assessment-test is required.");
  const unknown = args.filter((a, i) => !["--project", "--external-email"].includes(a) && !["--project", "--external-email"].includes(args[i - 1]));
  if (unknown.length) throw new Error("Unknown arguments.");
  console.log(stage(value("--project"), args.includes("--external-email") ? value("--external-email") : ""));
}
