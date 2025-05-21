export interface LibraryResponse {
    responseMetadata: ResponseMetadata
    records: Record[]
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
  