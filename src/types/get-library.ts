export interface LibraryItem {
  id: string;
  namespace: string;
  title: string;
  description: string;
  effectiveDate: string;
  keyImages: Array<{
    type: string;
    url: string;
  }>;
  seller: {
    id: string;
    name: string;
  };
  productSlug: string;
  urlSlug: string;
  url: string;
  tags: Array<{
    id: string;
  }>;
  items: Array<{
    id: string;
    namespace: string;
  }>;
  customAttributes: Array<{
    key: string;
    value: string;
  }>;
  categories: Array<{
    path: string;
  }>;
  catalogNs: {
    mappings: Array<{
      pageSlug: string;
      pageType: string;
    }>;
  };
}

export interface LibraryResponse {
  items: LibraryItem[];
  paging: {
    count: number;
    start: number;
    total: number;
  };
}
  
export interface ResponseMetadata {
  nextCursor: string
  stateToken: string
}
  
export interface Record {
  namespace: string
  catalogItemId: string
  appName: string
  productId: string
  sandboxName: string
  sandboxType: string
  recordType: string
  acquisitionDate: string
  dependencies: any[]
}
  