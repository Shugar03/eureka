fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // ONNX Runtime (local speech, Parakeet) comes with the DirectML provider compiled in, but
        // only the CPU is used: delay-loading DirectML (and dxcore, newer than some Windows 10)
        // means they're never loaded, so neither the installer nor the tests have to carry them.
        println!("cargo:rustc-link-arg=/DELAYLOAD:DirectML.dll");
        println!("cargo:rustc-link-arg=/DELAYLOAD:dxcore.dll");
        println!("cargo:rustc-link-lib=delayimp");
        vc_runtime();
    }
    tauri_build::build()
}

/// ONNX Runtime is C++ and needs the Visual C++ runtime (msvcp140), which not every Windows
/// has; the rest of the app links it statically. The installer carries Microsoft's
/// redistributable copies next to the exe (tauri.windows.conf.json); they're taken from the
/// Visual Studio that builds, or from this PC's own installed runtime.
fn vc_runtime() {
    use std::path::PathBuf;
    const DLLS: [&str; 4] = ["msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
    let out = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("vcruntime");
    println!("cargo:rerun-if-env-changed=VCToolsRedistDir");
    let mut sources = Vec::new();
    if let Ok(redist) = std::env::var("VCToolsRedistDir") {
        sources.push(PathBuf::from(redist).join("x64").join("Microsoft.VC143.CRT"));
    }
    for base in ["C:/Program Files/Microsoft Visual Studio", "C:/Program Files (x86)/Microsoft Visual Studio"] {
        // <year>/<edition>/VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT, newest version first.
        for year in std::fs::read_dir(base).into_iter().flatten().flatten() {
            for edition in std::fs::read_dir(year.path()).into_iter().flatten().flatten() {
                let msvc = edition.path().join("VC/Redist/MSVC");
                let mut versions: Vec<_> = std::fs::read_dir(&msvc).into_iter().flatten().flatten().map(|v| v.path().join("x64/Microsoft.VC143.CRT")).collect();
                versions.sort();
                sources.extend(versions.into_iter().rev());
            }
        }
    }
    sources.push(PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:/Windows".into())).join("System32"));
    let Some(from) = sources.into_iter().find(|d| DLLS.iter().all(|f| d.join(f).is_file())) else {
        panic!("no encontré el runtime de Visual C++ (msvcp140.dll) para el instalador: instalá las Build Tools de Visual Studio");
    };
    std::fs::create_dir_all(&out).unwrap();
    for f in DLLS {
        let (src, dst) = (from.join(f), out.join(f));
        if std::fs::metadata(&dst).map(|m| m.len()).ok() != std::fs::metadata(&src).map(|m| m.len()).ok() {
            std::fs::copy(&src, &dst).unwrap();
        }
    }
}
