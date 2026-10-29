import type { Box } from './pdf-images';
export interface PageContent {
    text: string;
    images: Box[];
    bounds: Box;
}
export declare function pageHasNothingToRead(content: PageContent): boolean;
export declare function pagesToSkip(contents: readonly PageContent[]): Set<number>;
export declare function pageContents(pdf: Buffer): Promise<PageContent[] | null>;
