use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

pub(super) struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    pub(super) fn set(key: &'static str, value: Option<&str>) -> Self {
        let previous = std::env::var(key).ok();
        match value {
            Some(value) => unsafe { std::env::set_var(key, value) },
            None => unsafe { std::env::remove_var(key) },
        }
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

pub(super) fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    match ENV_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

pub(super) fn woof_drivers() -> Vec<std::path::PathBuf> {
    let prefix = format!("caprice-woof-{}-", std::process::id());
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix))
        })
        .collect()
}
