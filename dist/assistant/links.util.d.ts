export type LinkBook = Map<string, string>;
export declare const FRESH_LINK_HINT = "(ask me for a fresh link)";
export declare function addLink(book: LinkBook, url: string): string;
export declare function fillLinks(text: string, book?: LinkBook | null): string;
