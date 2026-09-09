const path = require("node:path");

const firebaseToolsRoot = path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib");
const auth = require(path.join(firebaseToolsRoot, "auth"));
const cloudSql = require(path.join(firebaseToolsRoot, "gcp", "cloudsql", "connect"));
const cloudSqlAdmin = require(path.join(firebaseToolsRoot, "gcp", "cloudsql", "cloudsqladmin"));
const utils = require(path.join(firebaseToolsRoot, "utils"));

async function createSqlSession({ projectId, instanceId, databaseId, accountEmail, temporaryAdmin }) {
  const selectedAccount = auth.selectAccount(accountEmail, process.cwd());
  if (!selectedAccount) throw new Error(`Firebase account ${accountEmail} is not logged in.`);
  const firebaseOptions = { project: projectId, nonInteractive: true };
  auth.setActiveAccount(firebaseOptions, selectedAccount);

  if (!temporaryAdmin) {
    return {
      run(commands) {
        return cloudSql.executeSqlCmdsAsIamUser(firebaseOptions, instanceId, databaseId, commands, true);
      },
      async close() {}
    };
  }

  const username = `codexmigration${Date.now()}`;
  const password = utils.generatePassword(32);
  await cloudSqlAdmin.createUser(projectId, instanceId, "BUILT_IN", username, password);
  let closed = false;
  return {
    async run(commands) {
      const results = await cloudSql.execute(
        [`SET ROLE = '${username}'`, ...commands],
        { projectId, instanceId, databaseId, username, password, silent: true }
      );
      return results.slice(1);
    },
    async close() {
      if (closed) return;
      closed = true;
      await cloudSqlAdmin.deleteUser(projectId, instanceId, username);
      console.log(JSON.stringify({ temporaryDbUserDeleted: true, projectId }));
    }
  };
}

module.exports = { createSqlSession };
