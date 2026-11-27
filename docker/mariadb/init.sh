#!/bin/sh
set -eu

database_password() {
    case "$1" in
        "$2:"*@tcp\(*) ;;
        *) printf 'Invalid DSN for %s\n' "$2" >&2; return 1 ;;
    esac
    password=${1#*:}
    password=${password%%@tcp(*}
    case "$password" in
        ''|REPLACE_ME*|*[!a-zA-Z0-9_-]*)
            printf 'Set a valid password in the DSN for %s\n' "$2" >&2
            return 1 ;;
    esac
    printf '%s' "$password"
}

app_password=$(database_password "$SIMP2M_DB_DSN" simp2m_app)
migration_password=$(database_password "$SIMP2M_MIGRATION_DSN" simp2m_migrator)
trial_password=$(database_password "$SIMP2M_TRIAL_DSN" simp2m_trial_app)
trial_migration_password=$(database_password "$SIMP2M_TRIAL_MIGRATION_DSN" simp2m_trial_migrator)

MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --user=root <<SQL
CREATE DATABASE IF NOT EXISTS simp2m_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS simp2m_dev_trial CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'simp2m_app'@'%' IDENTIFIED BY '$app_password';
CREATE USER IF NOT EXISTS 'simp2m_migrator'@'%' IDENTIFIED BY '$migration_password';
CREATE USER IF NOT EXISTS 'simp2m_trial_app'@'%' IDENTIFIED BY '$trial_password';
CREATE USER IF NOT EXISTS 'simp2m_trial_migrator'@'%' IDENTIFIED BY '$trial_migration_password';

GRANT SELECT, INSERT, UPDATE, DELETE ON simp2m_dev.* TO 'simp2m_app'@'%';
GRANT ALL PRIVILEGES ON simp2m_dev.* TO 'simp2m_migrator'@'%';

GRANT SELECT, INSERT, UPDATE, DELETE ON simp2m_dev_trial.* TO 'simp2m_trial_app'@'%';
GRANT ALL PRIVILEGES ON simp2m_dev_trial.* TO 'simp2m_trial_migrator'@'%';

FLUSH PRIVILEGES;
SQL
