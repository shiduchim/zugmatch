/* Refuses real personal data in this PUBLIC repository.
   Fails on phone numbers and personal email addresses in tracked text files, and on test fixtures
   not marked as made up. Made-up phone numbers must contain "000" or "555" (e.g. 050-000-0012,
   (212) 555-0199); made-up emails must use example.com / example.org. */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/package-lock\.json$|\.(png|jpg|jpeg|webp|gif|ico|pdf|zip|jks|woff2?)$/i.test(f));

const phone = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g;
const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const problems = [];

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(phone)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 13) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(m[0])) continue;              /* dates */
      if (digits.includes('000') || digits.includes('555')) continue; /* made up */
      if (/sha|integrity|version|[a-f0-9]{16}/i.test(line)) continue;
      problems.push(`${file}:${i + 1} looks like a real phone number: ${m[0].trim()}`);
    }
    for (const m of line.matchAll(email)) {
      if (/@(example\.(com|org|net)|anthropic\.com|users\.noreply\.github\.com)$/i.test(m[0])) continue;
      problems.push(`${file}:${i + 1} looks like a real email address: ${m[0]}`);
    }
  });
  if (file.startsWith('tests/fixtures/') && !text.includes('SYNTHETIC')) {
    problems.push(`${file}: test fixtures must say SYNTHETIC near the top (made-up data only)`);
  }
}

if (problems.length) {
  console.error('Privacy check failed — this repository is public:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Privacy check passed (${files.length} files).`);
