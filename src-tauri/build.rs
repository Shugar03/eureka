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
    if !matches!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("android" | "ios")) {
        ocr_models();
    }
    tauri_build::build()
}

/// AC-187: PaddleOCR's models (Apache-2.0) go inside the installer (tauri.windows.conf.json)
/// but not in git: they're downloaded once into `ocr-models/`, pinned by size and sha256.
/// EUREKA_OCR_MODELS_FROM can point to a folder that already has them (offline builds).
fn ocr_models() {
    use sha2::{Digest, Sha256};
    use std::path::PathBuf;
    const BASE: &str = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx";
    const MODELS: [(&str, &str, u64, &str); 3] = [
        ("PP-OCRv6/det/PP-OCRv6_det_small.onnx", "PP-OCRv6_det_small.onnx", 9_929_594, "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"),
        ("PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx", "ch_ppocr_mobile_v2.0_cls_mobile.onnx", 585_532, "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"),
        ("PP-OCRv5/rec/latin_PP-OCRv5_rec_mobile.onnx", "latin_PP-OCRv5_rec_mobile.onnx", 7_904_513, "b20bd37c168a570f583afbc8cd7925603890efbcdc000a59e22c269d160b5f5a"),
    ];
    println!("cargo:rerun-if-env-changed=EUREKA_OCR_MODELS_FROM");
    let out = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("ocr-models");
    std::fs::create_dir_all(&out).unwrap();
    let hash = |p: &std::path::Path| std::fs::read(p).map(|b| Sha256::digest(&b).iter().map(|x| format!("{x:02x}")).collect::<String>()).unwrap_or_default();
    for (url, name, size, sha) in MODELS {
        let dst = out.join(name);
        println!("cargo:rerun-if-changed={}", dst.display());
        // Already there (its hash was checked when it arrived): the size is enough.
        if std::fs::metadata(&dst).map(|m| m.len()).ok() == Some(size) {
            continue;
        }
        let tmp = dst.with_extension("part");
        match std::env::var("EUREKA_OCR_MODELS_FROM").ok().map(|d| PathBuf::from(d).join(name)).filter(|p| p.is_file()) {
            Some(src) => {
                std::fs::copy(src, &tmp).unwrap();
            }
            None => {
                let ok = std::process::Command::new("curl").args(["-fsSL", "--retry", "3", "-o"]).arg(&tmp).arg(format!("{BASE}/{url}")).status().is_ok_and(|s| s.success());
                if !ok {
                    let _ = std::fs::remove_file(&tmp);
                    panic!("no pude bajar el modelo de OCR {name} ({BASE}/{url}); sin internet, poné los .onnx en una carpeta y apuntá EUREKA_OCR_MODELS_FROM ahí");
                }
            }
        }
        if hash(&tmp) != sha {
            let _ = std::fs::remove_file(&tmp);
            panic!("el modelo de OCR {name} no coincide con su sha256 fijado: no lo uso");
        }
        std::fs::rename(&tmp, &dst).unwrap();
    }
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
