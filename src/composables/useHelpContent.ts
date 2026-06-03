import { computed, ref } from "vue";
import type { FaqItem, HelpArticle, HelpCategory } from "@/firebase/interfaces";
import { HELP_CONTENT_SEED } from "@/data/help";
import {
  buildHelpIndex,
  searchHelp,
  type HelpSearchResult,
} from "@/utils/helpSearch";

// ---------------------------------------------------------------------------
// Help Center content access (bundled, synchronous).
//
// Help Center content is hardcoded in src/data/help.ts — there's no CMS and no
// fetch, so the Help Center renders instantly and works offline. Editing the
// FAQ/articles is a code change (and a deliberate one: see CLAUDE.md — every
// major feature should be checked against the Help Center / FAQ).
//
// The search index is built once at module load and shared by every Help view.
// ---------------------------------------------------------------------------

const { categories: seedCategories, articles: seedArticles, faqs: seedFaqs } =
  HELP_CONTENT_SEED;
const index = buildHelpIndex(seedArticles, seedFaqs);

// Content is available immediately; `ready` stays for API symmetry so views
// don't need to special-case a loading state that can't happen.
const ready = ref(true);

export function useHelpContent() {
  const categories = computed<HelpCategory[]>(() => seedCategories);
  const articles = computed<HelpArticle[]>(() => seedArticles);
  const faqs = computed<FaqItem[]>(() => seedFaqs);
  const popularArticles = computed(() => seedArticles.filter((a) => a.popular));

  function getCategory(id: string): HelpCategory | undefined {
    return seedCategories.find((c) => c.id === id);
  }

  function getArticle(slug: string): HelpArticle | undefined {
    return seedArticles.find((a) => a.slug === slug);
  }

  function articlesInCategory(categoryId: string): HelpArticle[] {
    return seedArticles.filter((a) => a.categoryId === categoryId);
  }

  function faqsInCategory(categoryId: string): FaqItem[] {
    return seedFaqs.filter((f) => f.categoryId === categoryId);
  }

  /** Up to `n` other articles in the same category. */
  function relatedArticles(article: HelpArticle, n = 4): HelpArticle[] {
    return seedArticles
      .filter((a) => a.categoryId === article.categoryId && a.slug !== article.slug)
      .slice(0, n);
  }

  function search(query: string, limit = 8): HelpSearchResult[] {
    return searchHelp(index, query, limit);
  }

  return {
    ready,
    categories,
    articles,
    faqs,
    popularArticles,
    getCategory,
    getArticle,
    articlesInCategory,
    faqsInCategory,
    relatedArticles,
    search,
  };
}
