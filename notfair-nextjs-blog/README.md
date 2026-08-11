# notfair-nextjs-blog

Render your [NotFair SEO](https://notfair.co/seo) exchange posts on
a Next.js (App Router) blog. Pull model: your site fetches published posts
server-side from the NotFair content API with a private key — nothing is ever
pushed to your infrastructure.

## Setup

1. Install the package and the server-side HTML sanitizer:

```bash
npm install notfair-nextjs-blog sanitize-html
npm install --save-dev @types/sanitize-html
```

2. In the NotFair SEO dashboard, create a **Next.js / headless**
   integration and copy the site API key (shown once).
3. Add it to your environment — server-side only, never `NEXT_PUBLIC_`:

```bash
NOTFAIR_SEO_API_KEY=nfbl_...
```

4. Publish NotFair posts under `/blog/{slug}`. The dashboard derives the
   verification URL automatically. If `/blog` already exists, merge NotFair
   into it as an additional source rather than replacing the route.

## Minimal app/blog

### Required safe article renderer

`content_html` is remote HTML. Do not render it directly or rely on browser
defaults for its typography: Tailwind's base reset removes heading hierarchy and
list markers unless the host site styles those elements explicitly. Keep the
presentation in the host app so it can match the existing blog design.

Create `src/lib/notfair-article.ts`:

```ts
import sanitizeHtml from "sanitize-html";

export function sanitizeNotFairArticleHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "figure", "figcaption", "h1", "h2", "h3", "h4", "img", "nav",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "title", "target", "rel"],
      div: ["class"],
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      li: ["class"],
      nav: ["aria-label", "class"],
      p: ["class"],
    },
    allowedClasses: {
      div: ["nf-tablewrap"],
      li: ["nf-toc-l2", "nf-toc-l3"],
      nav: ["nf-toc"],
      p: ["nf-attribution", "nf-toc-title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
  });
}
```

Create `app/blog/notfair-article.module.css`, then adapt the values to the
existing design system. Keep these selectors: they restore semantic hierarchy,
mobile table behavior, and NotFair's stable structural hooks.

```css
.articleContent { color: inherit; font-size: 1.0625rem; line-height: 1.75; }
.articleContent > * + * { margin-top: 1.25rem; }

.articleContent h1,
.articleContent h2,
.articleContent h3,
.articleContent h4 {
  font-weight: 600;
  letter-spacing: -0.01em;
  scroll-margin-top: 6rem;
}

.articleContent h2 { margin-top: 3rem; font-size: 1.5rem; line-height: 1.25; }
.articleContent h3 { margin-top: 2.25rem; font-size: 1.25rem; line-height: 1.35; }
.articleContent ul,
.articleContent ol { padding-left: 1.5rem; }
.articleContent ul { list-style: disc; }
.articleContent ol { list-style: decimal; }
.articleContent li + li { margin-top: 0.5rem; }
.articleContent a { color: var(--notfair-article-link, currentColor); text-decoration: underline; text-underline-offset: 0.2em; }
.articleContent blockquote { border-left: 3px solid var(--notfair-article-accent, currentColor); padding-left: 1rem; }

.articleContent :global(.nf-toc) {
  border: 1px solid var(--notfair-article-border, currentColor);
  border-radius: 0.5rem;
  padding: 1rem 1.25rem;
}
.articleContent :global(.nf-toc) ul { list-style: none; padding-left: 0; }
.articleContent :global(.nf-toc-l3) { padding-left: 1rem; }
.articleContent :global(.nf-toc-title) { font-weight: 600; }
.articleContent :global(.nf-tablewrap) { overflow-x: auto; }

.articleContent table { width: 100%; border-collapse: collapse; }
.articleContent th,
.articleContent td {
  border: 1px solid var(--notfair-article-border, currentColor);
  min-width: 11rem;
  padding: 0.75rem 1rem;
  text-align: left;
  vertical-align: top;
}
.articleContent :global(.nf-attribution) { font-size: 0.875rem; opacity: 0.75; }
```

The `nf-*` classes are a small, stable semantic contract:

- `nf-toc`, `nf-toc-title`, `nf-toc-l2`, and `nf-toc-l3` describe the table of contents.
- `nf-tablewrap` enables horizontal scrolling for wide tables on mobile.
- `nf-attribution` identifies the disclosure line.

Do not let the content generator emit your app's Tailwind utility classes. Use
the scoped CSS module above, or adapt the same selectors to the site's existing
article renderer. Tailwind Typography is optional only when it is already part
of the host application's design system.

`app/blog/page.tsx`:

```tsx
import Link from "next/link";
import { getSeoPosts } from "notfair-nextjs-blog";

export default async function BlogIndex() {
  const posts = await getSeoPosts();
  return (
    <main>
      <h1>Blog</h1>
      {posts.map((p) => (
        <article key={p.slug}>
          <Link href={`/blog/${p.slug}`}>{p.title}</Link>
        </article>
      ))}
    </main>
  );
}
```

`app/blog/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSeoPost } from "notfair-nextjs-blog";
import { sanitizeNotFairArticleHtml } from "@/lib/notfair-article";
import styles from "../notfair-article.module.css";

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getSeoPost(slug);
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <div
        className={styles.articleContent}
        dangerouslySetInnerHTML={{
          __html: sanitizeNotFairArticleHtml(post.content_html),
        }}
      />
    </article>
  );
}
```

Responses revalidate hourly by default (`{ revalidate }` option to change).

## Existing `/blog`

Keep your current blog queries, components, metadata, and styling. Native posts
win slug collisions; NotFair fills only the remaining index entries and slugs.

For the index, fetch both sources in parallel and merge them without reshaping
your existing post type:

```tsx
import { getSeoPosts, mergeBlogPosts } from "notfair-nextjs-blog";

const [existingPosts, seoPosts] = await Promise.all([
  getExistingPosts(),
  getSeoPosts(),
]);
const posts = mergeBlogPosts(existingPosts, seoPosts);

// Branch on item.source and render each source with the site's existing cards.
// Every item still links to /blog/${item.post.slug}.
```

For `app/blog/[slug]/page.tsx`, resolve the existing source first and call
NotFair only as a fallback:

```tsx
import { notFound } from "next/navigation";
import { getBlogPostWithSeoFallback } from "notfair-nextjs-blog";

const result = await getBlogPostWithSeoFallback(slug, getExistingPost);
if (!result) notFound();

if (result.source === "existing") {
  return <ExistingPost post={result.post} />;
}

return (
  <article>
    <h1>{result.post.title}</h1>
    <div
      className={styles.articleContent}
      dangerouslySetInnerHTML={{
        __html: sanitizeNotFairArticleHtml(result.post.content_html),
      }}
    />
  </article>
);
```

Apply the same native-first lookup in `generateMetadata`. Do not call
`notFound()` until both sources return no post.

## Verify before marking setup complete

Deploy a real NotFair post and check both desktop and mobile. Confirm the
featured image loads, headings are visually distinct, list markers are visible,
wide tables scroll horizontally, table-of-contents links jump to their
headings, and the attribution remains visible. Published pages must be publicly
reachable at the configured `/blog/{slug}` URL for link verification.

## API

- `getSeoPosts({ revalidate? })` → `[{ id, title, slug, published_at, created_at }]`
- `getSeoPost(slug, { revalidate? })` → adds `content_html`, or `null`
- `mergeBlogPosts(existing, seo)` → discriminated list; existing slugs win
- `getBlogPostWithSeoFallback(slug, getExistingPost, { revalidate? })` →
  `{ source, post }`, or `null`
