fn main() {
    link_libstdcpp();
    tauri_build::build()
}

// lld does not search the gcc private directory that holds libstdc++.so.
fn link_libstdcpp() {
    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() != Some("linux") {
        return;
    }
    let Ok(output) = std::process::Command::new("g++")
        .arg("-print-file-name=libstdc++.so")
        .output()
    else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let printed = String::from_utf8_lossy(&output.stdout);
    let path = std::path::Path::new(printed.trim());
    let Some(dir) = path.parent() else {
        return;
    };
    if dir.as_os_str().is_empty() {
        return;
    }
    println!("cargo:rustc-link-search=native={}", dir.display());
}
