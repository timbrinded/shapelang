use shape_semantic_kernel::check_json;
use std::io::{self, Read, Write};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let output = check_json(&input)?;
    io::stdout().write_all(output.as_bytes())?;
    Ok(())
}
