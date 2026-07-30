import { describe, expect, test } from "bun:test";
import { TOML } from "bun";
import { normalizeProjectConfigOrder } from "../src/config/write";

describe("config writes", () => {
  test("sorts project tables case-insensitively with deterministic case ties", () => {
    const unsorted = `version = 2

# Zulu project
[project."Zulu"]
source = "local"

[job.example]
schedule = "0 9 * * *"
prompt = '''
[project."not-a-table"]
'''

# lowercase project
[project.alpha]
source = "local"

# uppercase project
[project.Alpha]
source = "local"
`;
    const normalized = `version = 2

# uppercase project
[project.Alpha]
source = "local"

[job.example]
schedule = "0 9 * * *"
prompt = '''
[project."not-a-table"]
'''

# lowercase project
[project.alpha]
source = "local"

# Zulu project
[project."Zulu"]
source = "local"
`;

    expect(normalizeProjectConfigOrder(unsorted)).toBe(normalized);
    expect(normalizeProjectConfigOrder(normalized)).toBe(normalized);
    expect(TOML.parse(normalized)).toEqual(TOML.parse(unsorted));
  });

  test("leaves non-project tables, attached spacing, and array order in place", () => {
    const unsorted = `version = 2

[project.zebra]
source = "local"
tags = ["z", "a"]


[github]
owners = ["zeta", "alpha"]

[project.alpha]
source = "local"
`;
    const normalized = normalizeProjectConfigOrder(unsorted);

    expect(normalized).toBe(`version = 2

[project.alpha]
source = "local"


[github]
owners = ["zeta", "alpha"]

[project.zebra]
source = "local"
tags = ["z", "a"]
`);
  });

  test("sorts valid project headers with internal whitespace", () => {
    const unsorted = `[ project.zebra ]
source = "local"

[project . alpha]
source = "local"
`;

    expect(normalizeProjectConfigOrder(unsorted)).toBe(`[project . alpha]
source = "local"

[ project.zebra ]
source = "local"
`);
  });

  test("ignores table-shaped text inside multiline and single-line strings", () => {
    const unsorted = `[job.example]
prompt = """
[project.fake]
"""
repo_filter = "literal ''' does not open a multiline string"
# """ does not open a multiline string

[project.zebra]
source = "local"

[project.alpha]
source = "local"
`;
    const normalized = normalizeProjectConfigOrder(unsorted);

    expect(normalized.indexOf("[project.alpha]")).toBeLessThan(
      normalized.indexOf("[project.zebra]"),
    );
    expect(normalized).toContain('prompt = """\n[project.fake]\n"""');
  });
});
