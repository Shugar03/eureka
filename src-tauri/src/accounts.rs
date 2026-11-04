//! Subscription accounts (ChatGPT Plus/Pro today) kept apart from API keys.
//!
//! `auth.json` is a `HashMap<String, String>` and `SettingsStore::save` prunes
//! every key that is not a provider (settings.rs), so an OAuth token stored
//! there would disappear on the next save from Ajustes. Accounts live in their
//! own file: connecting or disconnecting an account never rewrites `auth.json`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One connected subscription account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    /// Which sign-in produced this. Only `"chatgpt"` exists today.
    pub kind: String,
    /// The account's id at the provider (ChatGPT: `chatgpt_account_id`).
    pub account_id: String,
    /// What Ajustes shows instead of the token.
    #[serde(default)]
    pub email: Option<String>,
    pub access: String,
    pub refresh: String,
    /// Unix milliseconds.
    pub expires: i64,
    /// Sent as `originator`; identifies Eureka to the provider's API.
    pub originator: String,
    /// Where the provider is actually served. Empty means "use the default
    /// for this kind" (the production URL); tests point it at a fake.
    #[serde(default)]
    pub base_url: String,
}

impl Account {
    /// True once the access token is expired, or close enough that a request
    /// started now could outlive it: five minutes of slack.
    pub fn needs_refresh(&self, now_ms: i64) -> bool {
        self.expires - 5 * 60 * 1000 <= now_ms
    }
}

/// `accounts.json` in the app's data directory, next to `settings.json`.
pub struct AccountsStore {
    dir: PathBuf,
}

impl AccountsStore {
    pub fn new(dir: &Path) -> Self {
        Self { dir: dir.to_path_buf() }
    }

    fn path(&self) -> PathBuf {
        self.dir.join("accounts.json")
    }

    /// Missing or unreadable file means "no accounts connected", like settings.
    pub fn load(&self) -> HashMap<String, Account> {
        std::fs::read_to_string(self.path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn get(&self, provider_id: &str) -> Option<Account> {
        self.load().remove(provider_id)
    }

    pub fn put(&self, provider_id: &str, account: &Account) -> Result<()> {
        let mut accounts = self.load();
        accounts.insert(provider_id.to_string(), account.clone());
        self.write(&accounts)
    }

    /// Disconnecting an account that is already gone is not an error.
    pub fn remove(&self, provider_id: &str) -> Result<()> {
        let mut accounts = self.load();
        if accounts.remove(provider_id).is_none() {
            return Ok(());
        }
        self.write(&accounts)
    }

    /// Write to a sibling file and rename over the old one: a crash mid-write
    /// must not leave a truncated `accounts.json`, which would silently log the
    /// learner out of every account at once.
    fn write(&self, accounts: &HashMap<String, Account>) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join("accounts.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(accounts)?).with_context(|| format!("no se pudo escribir {}", tmp.display()))?;
        std::fs::rename(&tmp, self.path()).with_context(|| format!("no se pudo guardar {}", self.path().display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("eureka-accounts-{name}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn account(name: &str) -> Account {
        Account {
            kind: "chatgpt".into(),
            account_id: format!("acc-{name}"),
            email: Some(format!("{name}@example.com")),
            access: format!("access-{name}"),
            refresh: format!("refresh-{name}"),
            expires: 1_800_000_000_000,
            originator: "eureka".into(),
            base_url: String::new(),
        }
    }

    #[test]
    fn missing_file_means_no_accounts() {
        let dir = tempdir("missing");
        assert!(AccountsStore::new(&dir).load().is_empty());
        assert!(AccountsStore::new(&dir).get("openai").is_none());
    }

    #[test]
    fn roundtrips_an_account() {
        let dir = tempdir("roundtrip");
        let store = AccountsStore::new(&dir);
        store.put("openai", &account("ana")).unwrap();
        assert_eq!(store.get("openai"), Some(account("ana")));
    }

    #[test]
    fn connecting_keeps_other_providers() {
        let dir = tempdir("keep");
        let store = AccountsStore::new(&dir);
        store.put("openai", &account("ana")).unwrap();
        store.put("other", &account("beto")).unwrap();
        store.remove("openai").unwrap();
        assert!(store.get("openai").is_none());
        assert_eq!(store.get("other"), Some(account("beto")));
    }

    #[test]
    fn removing_a_missing_account_is_not_an_error() {
        let dir = tempdir("absent");
        assert!(AccountsStore::new(&dir).remove("openai").is_ok());
    }

    #[test]
    fn corrupt_file_reads_as_empty_instead_of_panicking() {
        let dir = tempdir("corrupt");
        std::fs::write(dir.join("accounts.json"), "{ not json").unwrap();
        assert!(AccountsStore::new(&dir).load().is_empty());
    }

    #[test]
    fn refresh_is_due_five_minutes_before_expiry() {
        let a = account("ana");
        assert!(!a.needs_refresh(a.expires - 6 * 60 * 1000));
        assert!(a.needs_refresh(a.expires - 4 * 60 * 1000));
        assert!(a.needs_refresh(a.expires));
    }
}
