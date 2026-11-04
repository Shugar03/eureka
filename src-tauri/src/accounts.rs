//! Subscription accounts (ChatGPT Plus/Pro today) kept apart from API keys.
//!
//! `auth.json` is a `HashMap<String, String>` and `SettingsStore::save` prunes
//! every key that is not a provider (settings.rs), so an OAuth token stored
//! there would disappear on the next save from Ajustes. Accounts live in their
//! own file: connecting or disconnecting an account never rewrites `auth.json`.
//!
//! On desktop the access/refresh tokens are kept in the OS keystore (Windows
//! Credential Manager, macOS Keychain, Secret Service) instead of in the JSON
//! file, so stealing `accounts.json` alone does not leak them. On platforms
//! without a usable keystore (Android, headless CI) they fall back to the
//! JSON file, which is the previous behaviour.

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

/// What we persist to `accounts.json`: everything except the tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccountMeta {
    kind: String,
    account_id: String,
    #[serde(default)]
    email: Option<String>,
    expires: i64,
    originator: String,
    #[serde(default)]
    base_url: String,
}

impl AccountMeta {
    fn from_account(a: &Account) -> Self {
        Self { kind: a.kind.clone(), account_id: a.account_id.clone(), email: a.email.clone(), expires: a.expires, originator: a.originator.clone(), base_url: a.base_url.clone() }
    }
    fn into_account(self, access: String, refresh: String) -> Account {
        Account { kind: self.kind, account_id: self.account_id, email: self.email, access, refresh, expires: self.expires, originator: self.originator, base_url: self.base_url }
    }
}

#[allow(dead_code)]
const SERVICE: &str = "eureka-accounts";

fn keystore_available() -> bool {
    #[cfg(test)]
    { true }
    #[cfg(not(test))]
    {
        #[cfg(target_os = "android")]
        { false }
        #[cfg(not(target_os = "android"))]
        {
            use keyring::Entry;
            Entry::new(SERVICE, "__probe__").and_then(|e| e.set_password("probe")).is_ok()
                && Entry::new(SERVICE, "__probe__").and_then(|e| e.get_password()).is_ok()
                && Entry::new(SERVICE, "__probe__").and_then(|e| e.delete_credential()).is_ok()
        }
    }
}

#[cfg(test)]
static TEST_KEYSTORE: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> = std::sync::Mutex::new(None);

#[cfg(test)]
fn store_tokens(provider_id: &str, access: &str, refresh: &str) -> bool {
    let mut store = TEST_KEYSTORE.lock().unwrap();
    let store = store.get_or_insert_with(std::collections::HashMap::new);
    let payload = serde_json::json!({ "access": access, "refresh": refresh }).to_string();
    store.insert(provider_id.to_string(), payload);
    true
}

#[cfg(test)]
fn load_tokens(provider_id: &str) -> Option<(String, String)> {
    let store = TEST_KEYSTORE.lock().unwrap();
    let store = store.as_ref()?;
    let payload = store.get(provider_id)?;
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    Some((v.get("access")?.as_str()?.to_string(), v.get("refresh")?.as_str()?.to_string()))
}

#[cfg(test)]
fn delete_tokens(provider_id: &str) {
    if let Some(store) = TEST_KEYSTORE.lock().unwrap().as_mut() {
        store.remove(provider_id);
    }
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn store_tokens(provider_id: &str, access: &str, refresh: &str) -> bool {
    use keyring::Entry;
    let entry = match Entry::new(SERVICE, provider_id) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let payload = serde_json::json!({ "access": access, "refresh": refresh }).to_string();
    entry.set_password(&payload).is_ok()
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn load_tokens(provider_id: &str) -> Option<(String, String)> {
    use keyring::Entry;
    let entry = Entry::new(SERVICE, provider_id).ok()?;
    let payload = entry.get_password().ok()?;
    let v: serde_json::Value = serde_json::from_str(&payload).ok()?;
    Some((v.get("access")?.as_str()?.to_string(), v.get("refresh")?.as_str()?.to_string()))
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn delete_tokens(provider_id: &str) {
    use keyring::Entry;
    if let Ok(entry) = Entry::new(SERVICE, provider_id) {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn store_tokens(_provider_id: &str, _access: &str, _refresh: &str) -> bool { false }

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn load_tokens(_provider_id: &str) -> Option<(String, String)> { None }

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn delete_tokens(_provider_id: &str) {}

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
    /// Also migrates the old format (tokens inline in the JSON) into the OS
    /// keystore on the first load after an upgrade.
    pub fn load(&self) -> HashMap<String, Account> {
        let raw = std::fs::read_to_string(self.path()).ok();
        let Some(raw) = raw else { return HashMap::new() };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else { return HashMap::new() };
        let Some(obj) = value.as_object() else { return HashMap::new() };

        let has_tokens_in_json = obj.values().any(|v| v.get("access").is_some());

        // Keystore unavailable: use the old inline format (tokens in JSON).
        if !keystore_available() {
            if has_tokens_in_json {
                return serde_json::from_value(value).unwrap_or_default();
            }
            // New format but no keystore: tokens are lost, can't recover.
            return HashMap::new();
        }

        // Keystore available: migrate old format if needed.
        if has_tokens_in_json {
            let mut metadata: HashMap<String, AccountMeta> = HashMap::new();
            for (id, v) in obj {
                if let Ok(acc) = serde_json::from_value::<Account>(v.clone()) {
                    store_tokens(id, &acc.access, &acc.refresh);
                    metadata.insert(id.clone(), AccountMeta::from_account(&acc));
                }
            }
            let _ = self.write_metadata(&metadata);
            return self.load_from_metadata(&metadata);
        }

        // New format: metadata in JSON, tokens in keystore.
        let metadata: HashMap<String, AccountMeta> = serde_json::from_value(value).unwrap_or_default();
        self.load_from_metadata(&metadata)
    }

    fn load_from_metadata(&self, metadata: &HashMap<String, AccountMeta>) -> HashMap<String, Account> {
        let ks = keystore_available();
        let mut out = HashMap::new();
        for (id, meta) in metadata {
            let (access, refresh) = if ks {
                load_tokens(id).unwrap_or_default()
            } else {
                // Fallback: shouldn't happen in new format, but be safe.
                (String::new(), String::new())
            };
            out.insert(id.clone(), meta.clone().into_account(access, refresh));
        }
        out
    }

    pub fn get(&self, provider_id: &str) -> Option<Account> {
        self.load().remove(provider_id)
    }

    pub fn put(&self, provider_id: &str, account: &Account) -> Result<()> {
        if !keystore_available() {
            // Fallback: store everything inline (previous behaviour).
            let mut accounts: HashMap<String, Account> = self.load();
            accounts.insert(provider_id.to_string(), account.clone());
            std::fs::create_dir_all(&self.dir)?;
            let tmp = self.dir.join("accounts.json.tmp");
            std::fs::write(&tmp, serde_json::to_string_pretty(&accounts)?)?;
            std::fs::rename(&tmp, self.path())?;
            return Ok(());
        }
        let mut metadata = self.load_metadata();
        metadata.insert(provider_id.to_string(), AccountMeta::from_account(account));
        self.write_metadata(&metadata)?;
        if !store_tokens(provider_id, &account.access, &account.refresh) {
            // Keystore failed mid-flight: fall back to inline tokens so we
            // never lose a freshly obtained token.
            let mut inline: HashMap<String, Account> = HashMap::new();
            for (id, meta) in &metadata {
                let (access, refresh) = if id == provider_id {
                    (account.access.clone(), account.refresh.clone())
                } else {
                    load_tokens(id).unwrap_or_default()
                };
                inline.insert(id.clone(), meta.clone().into_account(access, refresh));
            }
            std::fs::write(self.path(), serde_json::to_string_pretty(&inline)?)?;
        }
        Ok(())
    }

    pub fn remove(&self, provider_id: &str) -> Result<()> {
        if !keystore_available() {
            // Fallback: old inline format.
            let mut accounts: HashMap<String, Account> = self.load();
            if accounts.remove(provider_id).is_none() {
                return Ok(());
            }
            std::fs::create_dir_all(&self.dir)?;
            let tmp = self.dir.join("accounts.json.tmp");
            std::fs::write(&tmp, serde_json::to_string_pretty(&accounts)?)?;
            std::fs::rename(&tmp, self.path())?;
            return Ok(());
        }
        let mut metadata = self.load_metadata();
        if metadata.remove(provider_id).is_none() {
            if keystore_available() { delete_tokens(provider_id); }
            return Ok(());
        }
        self.write_metadata(&metadata)?;
        if keystore_available() { delete_tokens(provider_id); }
        Ok(())
    }

    fn load_metadata(&self) -> HashMap<String, AccountMeta> {
        let raw = std::fs::read_to_string(self.path()).ok();
        let Some(raw) = raw else { return HashMap::new() };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else { return HashMap::new() };
        // Old format (tokens inline): treat as empty metadata; migration happens in load().
        if value.as_object().map(|o| o.values().any(|v| v.get("access").is_some())).unwrap_or(false) {
            return HashMap::new();
        }
        serde_json::from_value(value).unwrap_or_default()
    }

    /// Write to a sibling file and rename over the old one: a crash mid-write
    /// must not leave a truncated `accounts.json`, which would silently log the
    /// learner out of every account at once.
    fn write_metadata(&self, metadata: &HashMap<String, AccountMeta>) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join("accounts.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(metadata)?).with_context(|| format!("no se pudo escribir {}", tmp.display()))?;
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

    #[test]
    fn migration_moves_inline_tokens_to_keystore() {
        // Simulate an old-format file (tokens inline).
        let dir = tempdir("migrate");
        let old = serde_json::json!({
            "openai": {
                "kind": "chatgpt",
                "account_id": "acc-ana",
                "email": "ana@example.com",
                "access": "access-ana",
                "refresh": "refresh-ana",
                "expires": 1_800_000_000_000_i64,
                "originator": "eureka",
                "base_url": ""
            }
        });
        std::fs::write(dir.join("accounts.json"), serde_json::to_string_pretty(&old).unwrap()).unwrap();

        let store = AccountsStore::new(&dir);
        let loaded = store.load();
        assert_eq!(loaded.get("openai").map(|a| a.access.as_str()), Some("access-ana"));
        assert_eq!(loaded.get("openai").map(|a| a.refresh.as_str()), Some("refresh-ana"));

        // After migration, the JSON should no longer contain tokens.
        let raw = std::fs::read_to_string(dir.join("accounts.json")).unwrap();
        assert!(!raw.contains("access-ana"), "tokens must leave the JSON after migration");
        assert!(!raw.contains("refresh-ana"));
    }
}
