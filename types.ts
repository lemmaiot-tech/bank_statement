export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  notes?: string;
}

export interface Category {
  id:string;
  name: string;
}

export interface Session {
  id: string;
  name: string;
  timestamp: number;
  transactions: Transaction[];
  categories: Category[];
}
