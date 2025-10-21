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