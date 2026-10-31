import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssignedUserBadge } from "./AssignedUserBadge";

describe("AssignedUserBadge", () => {
  test("renders name and avatar image when avatar is provided", () => {
    const html = renderToStaticMarkup(
      <AssignedUserBadge
        name="Mehan Ahmed"
        avatarUrl="https://example.com/mehan.webp"
      />,
    );

    expect(html).toContain("Mehan Ahmed");
    expect(html).toContain('src="https://example.com/mehan.webp"');
    expect(html).toContain("Assigned to Mehan Ahmed");
  });

  test("renders initials fallback when avatar is null", () => {
    const html = renderToStaticMarkup(
      <AssignedUserBadge
        name="Tanvir Ahmed"
        avatarUrl={null}
      />,
    );

    expect(html).toContain("Tanvir Ahmed");
    expect(html).toContain("TA");
    expect(html).not.toContain("<img");
  });

  test("renders single-word initial fallback correctly", () => {
    const html = renderToStaticMarkup(
      <AssignedUserBadge
        name="Support"
        avatarUrl={null}
      />,
    );

    expect(html).toContain("Support");
    expect(html).toContain("SU");
  });
});
