//! System prompt composition. Defaults are compiled into the binary; a file
//! at `<data>/prompts/<name>.md` overrides the default (editable from the UI).

use crate::session::{Phase, Session};
use anyhow::{bail, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

const DEFAULTS: &[(&str, &str)] = &[
    ("shared", include_str!("../prompts/shared.md")),
    ("probe", include_str!("../prompts/probe.md")),
    ("plan", include_str!("../prompts/plan.md")),
    ("teach", include_str!("../prompts/teach.md")),
    ("done", include_str!("../prompts/done.md")),
    ("extract", include_str!("../prompts/extract.md")),
    ("practice_generate", include_str!("../prompts/practice_generate.md")),
    ("practice_grade", include_str!("../prompts/practice_grade.md")),
    ("practice_hint", include_str!("../prompts/practice_hint.md")),
    ("practice_own", include_str!("../prompts/practice_own.md")),
    ("research", include_str!("../prompts/research.md")),
    ("exam_syllabus", include_str!("../prompts/exam_syllabus.md")),
    ("exam_questions", include_str!("../prompts/exam_questions.md")),
    ("exam_guide", include_str!("../prompts/exam_guide.md")),
    ("exam_cheat_sheet", include_str!("../prompts/exam_cheat_sheet.md")),
    ("exam_check", include_str!("../prompts/exam_check.md")),
    ("exam_explain", include_str!("../prompts/exam_explain.md")),
    ("cards_generate", include_str!("../prompts/cards_generate.md")),
    ("code_explain", include_str!("../prompts/code_explain.md")),
    ("code_exercise", include_str!("../prompts/code_exercise.md")),
    ("code_review", include_str!("../prompts/code_review.md")),
    ("lang_path", include_str!("../prompts/lang_path.md")),
    ("vision_transcribe", include_str!("../prompts/vision_transcribe.md")),
    ("code_project", include_str!("../prompts/code_project.md")),
    ("lang_listening", include_str!("../prompts/lang_listening.md")),
    ("lang_speaking", include_str!("../prompts/lang_speaking.md")),
    ("summarize_history", include_str!("../prompts/summarize_history.md")),
    ("remember_session", include_str!("../prompts/remember_session.md")),
    ("chat", include_str!("../prompts/chat.md")),
    ("academic_parse", include_str!("../prompts/academic_parse.md")),
    ("career_parse", include_str!("../prompts/career_parse.md")),
    ("companion", include_str!("../prompts/companion.md")),
    ("companion_entry", include_str!("../prompts/companion_entry.md")),
    ("class_notes", include_str!("../prompts/class_notes.md")),
];

#[derive(Debug, Serialize)]
pub struct PromptView {
    pub name: String,
    pub content: String,
    pub default_content: String,
    pub overridden: bool,
}

pub struct Prompts {
    dir: PathBuf,
}

impl Prompts {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("prompts") }
    }

    fn default_of(name: &str) -> Result<&'static str> {
        match DEFAULTS.iter().find(|(n, _)| *n == name) {
            Some((_, c)) => Ok(c),
            None => bail!("prompt desconocido: {name}"),
        }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.md"))
    }

    pub fn get(&self, name: &str) -> Result<String> {
        let default = Self::default_of(name)?;
        Ok(std::fs::read_to_string(self.path(name)).unwrap_or_else(|_| default.to_string()))
    }

    pub fn list(&self) -> Vec<PromptView> {
        DEFAULTS
            .iter()
            .map(|(name, default)| {
                let custom = std::fs::read_to_string(self.path(name)).ok();
                PromptView {
                    name: name.to_string(),
                    overridden: custom.is_some(),
                    content: custom.unwrap_or_else(|| default.to_string()),
                    default_content: default.to_string(),
                }
            })
            .collect()
    }

    pub fn save(&self, name: &str, content: &str) -> Result<()> {
        Self::default_of(name)?;
        std::fs::create_dir_all(&self.dir)?;
        std::fs::write(self.path(name), content)?;
        Ok(())
    }

    pub fn reset(&self, name: &str) -> Result<()> {
        Self::default_of(name)?;
        let p = self.path(name);
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        Ok(())
    }

    /// shared + the current phase's fragment + a live state block.
    /// `known` are graph propositions related to the goal (AC-20).
    pub fn system_prompt(&self, s: &Session, known: &[&str]) -> Result<String> {
        Ok(format!("{}\n\n{}", self.phase_prompt(s)?, state_block(s, known)))
    }

    /// shared + the phase's fragment: what the agent loop sends as the system
    /// prompt. It only changes with the phase, so it caches well (audit M3);
    /// the state block goes as the last message (`context::state_message`).
    pub fn phase_prompt(&self, s: &Session) -> Result<String> {
        let phase = match s.phase {
            Phase::Chat => "chat",
            Phase::Probe => "probe",
            Phase::Plan => "plan",
            Phase::Teach => "teach",
            Phase::Done => "done",
        };
        Ok(format!("{}\n\n{}", self.get("shared")?, self.get(phase)?))
    }
}

/// The session state the model must always see, regardless of history length.
pub fn state_block(s: &Session, known: &[&str]) -> String {
    if s.phase == Phase::Chat {
        return String::from("# Estado actual de la sesión\n\n- Fase: chat (conversación libre).\n- Todavía no hay un objetivo de aprendizaje: la persona no pidió aprender nada concreto.\n");
    }
    let mut out = String::from("# Estado actual de la sesión\n\n");
    out.push_str(&format!("- Objetivo del aprendiz: {}\n", s.goal));
    out.push_str(&format!("- Fase: {}\n", format!("{:?}", s.phase).to_lowercase()));

    out.push_str("\n## Diagnóstico\n");
    if s.findings.is_empty() {
        out.push_str("(todavía nada)\n");
    }
    for f in &s.findings {
        let level = format!("{:?}", f.level).to_lowercase();
        out.push_str(&format!("- {} → {}: {}\n", f.concept, level, f.evidence));
    }

    if !known.is_empty() {
        out.push_str("\n## Ya en el grafo (de sesiones o notas anteriores)\n");
        out.push_str("No las reenseñes: si el diagnóstico confirma que siguen firmes, marcalas como `known` en el plan.\n");
        for k in known {
            out.push_str(&format!("- {k}\n"));
        }
    }

    if let Some(e) = s.exam.as_ref().filter(|e| e.lang.is_some()) {
        out.push_str(&format!(
            "\n## Ruta de programación\nEste tema es parte de **{}**, módulo «{}». Lenguaje: **{}**.\n",
            e.exam_name,
            e.domain,
            e.lang.as_deref().unwrap_or("")
        ));
        out.push_str(&format!("Enseñá con código: mostrá ejemplos cortos y ejercicios con `show_code` (language = {}), pedile que **prediga la salida** antes de ejecutarlos en su consola y que te cuente qué pasó. Objetivos del tema:\n", e.lang.as_deref().unwrap_or("")));
        for o in &e.objectives {
            out.push_str(&format!("- {o}\n"));
        }
    } else if let Some(e) = &s.exam {
        out.push_str(&format!(
            "\n## Preparación de examen\nEste tema es parte de **{}**, dominio «{}» ({}% del examen).\n",
            e.exam_name, e.domain, e.weight
        ));
        out.push_str("El plan tiene que cubrir estos objetivos oficiales, y las verificaciones conviene que sean preguntas de escenario al estilo del examen:\n");
        if e.objectives.is_empty() {
            out.push_str("- (la guía no detalla objetivos: cubrí el tema completo)\n");
        }
        for o in &e.objectives {
            out.push_str(&format!("- {o}\n"));
        }
    }

    out.push_str("\n## Plan\n");
    if s.plan.is_empty() {
        out.push_str("(sin plan)\n");
    }
    for n in &s.plan {
        let deps = if n.depends_on.is_empty() { String::new() } else { format!(" ← {}", n.depends_on.join(", ")) };
        let note = if n.note.is_empty() { String::new() } else { format!(" — nota: {}", n.note) };
        out.push_str(&format!("- [{}] `{}` {}{}{}\n", format!("{:?}", n.status).to_lowercase(), n.id, n.title, deps, note));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("la-prompts-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn override_wins_and_reset_restores_default() {
        let dir = tmp();
        let p = Prompts::new(&dir);
        let default = p.get("teach").unwrap();
        p.save("teach", "CUSTOM").unwrap();
        assert_eq!(p.get("teach").unwrap(), "CUSTOM");
        assert!(p.list().iter().any(|v| v.name == "teach" && v.overridden));
        p.reset("teach").unwrap();
        assert_eq!(p.get("teach").unwrap(), default);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejects_unknown_prompt_names() {
        let p = Prompts::new(&tmp());
        assert!(p.save("../evil", "x").is_err());
    }

    #[test]
    fn system_prompt_follows_phase() {
        let p = Prompts::new(&tmp());
        let mut s = Session::new("entender derivadas");
        assert!(p.system_prompt(&s, &[]).unwrap().contains("Fase: MEDIR"));
        assert!(!p.system_prompt(&s, &[]).unwrap().contains("## Ya en el grafo"));
        let with_graph = p.system_prompt(&s, &["La derivada es la pendiente"]).unwrap();
        assert!(with_graph.contains("## Ya en el grafo") && with_graph.contains("- La derivada es la pendiente"));
        s.phase = Phase::Teach;
        let sp = p.system_prompt(&s, &[]).unwrap();
        assert!(sp.contains("Fase: ENSEÑAR"));
        assert!(sp.contains("entender derivadas"));
    }

    #[test]
    fn exam_block_lists_exam_domain_and_objectives() {
        let mut s = Session::new("IAM");
        assert!(!state_block(&s, &[]).contains("Preparación de examen"));
        s.exam = Some(crate::session::ExamLink {
            exam_id: "e".into(),
            exam_name: "AWS CCP".into(),
            domain: "Seguridad".into(),
            weight: 30.0,
            topic_id: "d1t1".into(),
            objectives: vec!["Usuarios y roles".into()],
            lang: None,
        });
        let b = state_block(&s, &[]);
        assert!(b.contains("**AWS CCP**, dominio «Seguridad» (30% del examen)"));
        assert!(b.contains("- Usuarios y roles"));
        s.exam.as_mut().unwrap().objectives.clear();
        assert!(state_block(&s, &[]).contains("cubrí el tema completo"));
        let e = s.exam.as_mut().unwrap();
        e.lang = Some("rust".into());
        e.exam_name = "Ruta de Rust".into();
        let b = state_block(&s, &[]);
        assert!(b.contains("## Ruta de programación") && b.contains("Lenguaje: **rust**") && b.contains("`show_code` (language = rust)"));
        assert!(!b.contains("Preparación de examen"));
    }
}
