# Cloud SQL backup, rollback, and recovery runbook

## Protected service

- Google Cloud project: `student-assessment-2d869`
- Cloud SQL instance: `student-assessment-db`
- PostgreSQL database: `student_assessment`
- Region: `northamerica-northeast1`
- Firebase Data Connect service: `student-assessment`

The application-level **Revert import** action is not a database rollback. It can reverse a known import snapshot in application data, but it does not replace Cloud SQL backups or point-in-time recovery (PITR).

## Required protection baseline

- Automated daily backups enabled during the school's lowest-traffic window.
- PITR enabled with a documented transaction-log retention period.
- Automated backup retention set to the approved number of days.
- Backup retention after instance deletion enabled.
- Final backup on deletion enabled.
- Cloud-level instance deletion protection enabled.
- A quarterly restore drill into a new validation instance.
- Separate IAM roles for backup inspection and recovery execution.

Enabling PITR on an existing instance can restart it. Backups consume paid storage. Obtain approval for the maintenance window, retention, and cost before changing the live instance.

## Read-only preflight

Run the checked-in preflight script from an authenticated Google Cloud SDK shell:

```powershell
.\scripts\sql-recovery-preflight.ps1
```

The script only describes configuration and lists existing backups. Confirm these fields in its output:

- `settings.backupConfiguration.enabled`
- `settings.backupConfiguration.pointInTimeRecoveryEnabled`
- `settings.backupConfiguration.transactionLogRetentionDays`
- `settings.backupConfiguration.retainedBackups`
- `settings.deletionProtectionEnabled`
- instance-level deletion protection
- the most recent successful backup timestamp

## Configuration change

Use the Google Cloud console or an approved infrastructure change. Do not paste a production mutation from this runbook without first capturing the preflight output and confirming a maintenance window.

After any change, run the preflight again and attach its output to the work item. Then create an on-demand backup:

```powershell
gcloud sql backups create --instance=student-assessment-db --project=student-assessment-2d869 --description="post-protection-baseline"
```

Wait for `SUCCESSFUL` before considering the protection baseline complete.

## Point-in-time recovery drill

Never test PITR by overwriting the production instance. Restore to a new instance and validate it before deciding on cutover.

1. Record the incident or drill timestamp in UTC/RFC 3339.
2. Confirm that it falls between the earliest and latest available recovery times.
3. Choose a new target name such as `student-assessment-recovery-YYYYMMDD`.
4. Clone the source at the selected timestamp:

```powershell
gcloud sql instances clone student-assessment-db student-assessment-recovery-YYYYMMDD --point-in-time="2026-08-09T16:00:00Z" --project=student-assessment-2d869
```

5. Keep production traffic on the original instance.
6. Validate schema migrations, row counts, recent assessment records, audit events, and representative application queries against the recovery instance.
7. Export or copy only the approved recovered records for a surgical repair, or schedule a controlled Data Connect datasource cutover after a separate approval.
8. Retain the original instance until validation, stakeholder sign-off, and a fresh backup are complete.

## Backup restore drill

1. Identify a successful backup and capture its ID, source instance, start/end timestamps, and retention status.
2. Restore it to a new recovery instance.
3. Connect with a read-only validation account.
4. Verify migrations, table counts, newest and oldest expected records, foreign keys, and representative assessment histories.
5. Record recovery point objective, recovery time objective, and every manual step.
6. Remove the temporary instance only after the drill evidence is approved; deleting it is a separate cost-impacting action.

## Application rollback boundary

For an import rollback, the application must apply an explicit inverse change set in one transaction: restore changed rows, remove rows and enrollments created solely by the import, retain pre-existing students and assessment history, and append an audit event. A successful UI message must not appear unless all database changes commit.

Until that Admin-authorized transactional connector operation is deployed, the application blocks rollback for any import that created SQL student records. This prevents a partial UI-only rollback from leaving hidden students in SQL or deleting students that gained later enrollments, results, notes, files, or reports.

For a schema or deployment rollback, prefer a forward-fix migration. If a destructive migration is unavoidable, take and verify an on-demand backup first, stop writers, restore into a new instance, validate, and only then change the Data Connect datasource.

## Evidence required to close the work item

- Current instance configuration captured after the change.
- A successful backup newer than the configuration change.
- PITR earliest/latest recovery timestamps.
- A completed restore-to-new-instance drill with validation results.
- Named owners and review dates for the runbook.
- A documented maintenance and incident communication path.

Official references:

- <https://cloud.google.com/sql/docs/postgres/backup-recovery/backups>
- <https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr>
- <https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr>
