/**
 * IndexedDB를 사용한 IFC 속성 데이터 저장/조회
 * 메모리 절약을 위해 상세 속성은 DB에 저장하고 필요시 조회
 */

const DB_NAME = "ifc-properties-db";
const DB_VERSION = 1;
const STORE_NAME = "properties";

export interface IFCPropertyData {
  expressID: number;
  name?: string;
  description?: string;
  objectType?: string;
  globalId?: string;
  properties: Record<string, any>;
  relationships: {
    containedIn?: number;
    contains?: number[];
  };
}

class PropertyDB {
  private db: IDBDatabase | null = null;
  private modelId: string = "";

  async init(modelId: string): Promise<void> {
    this.modelId = modelId;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`${DB_NAME}-${modelId}`, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "expressID" });
          store.createIndex("objectType", "objectType", { unique: false });
          store.createIndex("containedIn", "relationships.containedIn", { unique: false });
        }
      };
    });
  }

  async storeProperties(properties: IFCPropertyData[]): Promise<void> {
    if (!this.db) throw new Error("DB not initialized");
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      
      let completed = 0;
      const total = properties.length;
      
      for (const prop of properties) {
        const request = store.put(prop);
        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      }
      
      if (total === 0) resolve();
    });
  }

  async getProperty(expressID: number): Promise<IFCPropertyData | null> {
    if (!this.db) return null;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(expressID);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getPropertiesByType(objectType: string): Promise<IFCPropertyData[]> {
    if (!this.db) return [];
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("objectType");
      const request = index.getAll(objectType);
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getPropertiesByContainer(containerId: number): Promise<IFCPropertyData[]> {
    if (!this.db) return [];
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("containedIn");
      const request = index.getAll(containerId);
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async deleteDatabase(): Promise<void> {
    this.close();
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`${DB_NAME}-${this.modelId}`);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// 싱글톤 인스턴스
export const propertyDB = new PropertyDB();
