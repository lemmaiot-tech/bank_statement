

import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Transaction, Category } from './types';
import { UploadIcon, TrashIcon, DownloadIcon, PlusIcon, PencilIcon, CheckIcon, XIcon } from './components/icons';

// Helper function to convert File to a GoogleGenerativeAI.Part
const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: {
            data: await base64EncodedDataPromise,
            mimeType: file.type
        }
    };
};


type AppState = 'upload' | 'analyzing' | 'error';

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>('upload');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [categories, setCategories] = useState<Category[]>(() => {
        try {
            const savedCategories = localStorage.getItem('bankAnalyzerCategories');
            if (savedCategories) {
                return JSON.parse(savedCategories);
            }
        } catch (error) {
            console.error("Could not load categories from local storage", error);
        }
        // Default categories if nothing in local storage or if parsing fails
        return [
            { id: '1', name: 'Groceries' },
            { id: '2', name: 'Utilities' },
            { id: '3', name: 'Rent' },
            { id: '4', name: 'Entertainment' },
        ];
    });
    const [newCategoryName, setNewCategoryName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);

    // State for editing and deleting categories
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

    // State for editing notes
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editingNoteText, setEditingNoteText] = useState('');

    // State for filtering
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [filterMinAmount, setFilterMinAmount] = useState('');
    const [filterMaxAmount, setFilterMaxAmount] = useState('');

    // Save categories to local storage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('bankAnalyzerCategories', JSON.stringify(categories));
        } catch (error) {
            console.error("Could not save categories to local storage", error);
        }
    }, [categories]);


    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setAppState('analyzing');
            setTransactions([]);
            setErrorMessage('');
            setIsStreaming(true);
            try {
                if (!process.env.API_KEY) {
                    throw new Error("API_KEY environment variable not set.");
                }
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
                const pdfPart = await fileToGenerativePart(file);

                const prompt = `You are an expert data extraction AI specializing in financial documents. Your single task is to meticulously analyze the provided PDF bank statement and extract every transaction.

**CRITICAL INSTRUCTIONS:**
1.  **PROCESS THE ENTIRE DOCUMENT**: It is absolutely essential that you process the PDF from the first page to the last. Do not stop partway through. Extract all transactions until the very end of the statement.
2.  **STRICT OUTPUT FORMAT**:
    - Each transaction MUST be a single, minified JSON object on its own line.
    - There should be NO other text, explanations, summaries, or markdown formatting (like \`\`\`json) in your output. Only a stream of JSON objects.
3.  **REQUIRED JSON FIELDS**: Each JSON object must contain these exact keys and data types:
    - "date": (string) in "YYYY-MM-DD" format.
    - "description": (string) for the transaction details.
    - "amount": (number) for the transaction value.
    - "type": (string) which must be either "debit" or "credit".
4.  **CURRENCY CONTEXT**: All amounts are in Nigerian Naira (NGN). Do not include currency symbols or codes in the "amount" field.

Failure to process the entire document will result in an incorrect analysis. Begin extraction.`;

                const stream = await ai.models.generateContentStream({
                    model: "gemini-2.5-flash",
                    contents: { parts: [{ text: prompt }, pdfPart] },
                });

                let buffer = '';
                let transactionCount = 0;
                for await (const chunk of stream) {
                    buffer += chunk.text;
                    const lines = buffer.split('\n');
                    
                    buffer = lines.pop() || ''; 
                    
                    const newTxs: Transaction[] = [];
                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const txData = JSON.parse(line);
                                if (txData.date && txData.description && typeof txData.amount === 'number' && txData.type) {
                                    newTxs.push({
                                        ...txData,
                                        id: `${Date.now()}-${transactionCount++}`,
                                        category: 'Uncategorized',
                                    });
                                }
                            } catch (e) {
                                console.warn("Could not parse JSON line:", line);
                            }
                        }
                    }
                    if (newTxs.length > 0) {
                        setTransactions(prev => [...prev, ...newTxs]);
                    }
                }

                if (buffer.trim()) {
                     try {
                        const txData = JSON.parse(buffer);
                         if (txData.date && txData.description && typeof txData.amount === 'number' && txData.type) {
                            setTransactions(prev => [...prev, {
                                ...txData,
                                id: `${Date.now()}-${transactionCount++}`,
                                category: 'Uncategorized',
                            }]);
                        }
                    } catch(e) {
                        console.error("Could not parse final buffer content:", buffer);
                    }
                }

            } catch (error) {
                console.error("Error processing statement:", error);
                setErrorMessage(`Failed to analyze statement. ${error instanceof Error ? error.message : 'Unknown error.'}`);
                setAppState('error');
            } finally {
                setIsStreaming(false);
            }
        } else {
            setErrorMessage('Please upload a valid PDF file.');
            setAppState('error');
            setTimeout(() => {
                setAppState(prevState => {
                    if (prevState === 'error') {
                        setErrorMessage('');
                        return 'upload';
                    }
                    return prevState;
                });
            }, 3000)
        }
    };
    
    const handleAddCategory = () => {
        if (newCategoryName.trim() && !categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase())) {
            const newCategory: Category = {
                id: Date.now().toString(),
                name: newCategoryName.trim(),
            };
            setCategories([...categories, newCategory]);
            setNewCategoryName('');
        }
    };

    const handleDeleteCategory = (categoryId: string) => {
        setDeletingCategoryId(categoryId);
        setTimeout(() => {
            const categoryToDelete = categories.find(c => c.id === categoryId);
            setCategories(prev => prev.filter(c => c.id !== categoryId));
            if (categoryToDelete) {
                setTransactions(prevTx => prevTx.map(t => 
                    t.category === categoryToDelete.name ? { ...t, category: 'Uncategorized' } : t
                ));
            }
            setDeletingCategoryId(null);
        }, 300);
    };

    const handleStartEditingCategory = (category: Category) => {
        setEditingCategoryId(category.id);
        setEditingCategoryName(category.name);
    };

    const handleCancelEditing = () => {
        setEditingCategoryId(null);
        setEditingCategoryName('');
    };

    const handleSaveCategory = (categoryId: string) => {
        const trimmedName = editingCategoryName.trim();
        if (!trimmedName || categories.some(c => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== categoryId)) {
            handleCancelEditing();
            return;
        }
    
        const oldCategory = categories.find(c => c.id === categoryId);
        if (!oldCategory) return;
    
        const oldCategoryName = oldCategory.name;
    
        setCategories(categories.map(c => 
            c.id === categoryId ? { ...c, name: trimmedName } : c
        ));
    
        setTransactions(transactions.map(t => 
            t.category === oldCategoryName ? { ...t, category: trimmedName } : t
        ));
    
        handleCancelEditing();
    };

    const handleTransactionCategoryChange = (transactionId: string, newCategory: string) => {
        setTransactions(transactions.map(t => t.id === transactionId ? { ...t, category: newCategory } : t));
    };

    const handleStartEditingNote = (tx: Transaction) => {
        setEditingNoteId(tx.id);
        setEditingNoteText(tx.notes || '');
    };

    const handleCancelEditingNote = () => {
        setEditingNoteId(null);
        setEditingNoteText('');
    };

    const handleSaveNote = (transactionId: string) => {
        setTransactions(transactions.map(t =>
            t.id === transactionId ? { ...t, notes: editingNoteText.trim() } : t
        ));
        handleCancelEditingNote();
    };


    const handleExportToCsv = () => {
        const headers = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Notes'];
        const rows = filteredTransactions.map(t => [
            t.date,
            `"${t.description.replace(/"/g, '""')}"`,
            t.amount,
            t.type,
            t.category,
            `"${(t.notes || '').replace(/"/g, '""')}"`
        ].join(','));

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.href) {
            URL.revokeObjectURL(link.href);
        }
        link.href = URL.createObjectURL(blob);
        link.download = 'statement_analysis.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleClearFilters = () => {
        setSearchQuery('');
        setFilterCategory('all');
        setFilterStartDate('');
        setFilterEndDate('');
        setFilterMinAmount('');
        setFilterMaxAmount('');
    };
    
    const resetApp = () => {
        setAppState('upload');
        setTransactions([]);
        setErrorMessage('');
        handleClearFilters();
    };

    const filteredTransactions = transactions.filter(tx => {
        const searchMatch = tx.description.toLowerCase().includes(searchQuery.toLowerCase());
        const categoryMatch = filterCategory === 'all' || tx.category === filterCategory;
        const startDateMatch = !filterStartDate || tx.date >= filterStartDate;
        const endDateMatch = !filterEndDate || tx.date <= filterEndDate;
        
        const minAmountVal = parseFloat(filterMinAmount);
        const maxAmountVal = parseFloat(filterMaxAmount);
        const minMatch = filterMinAmount === '' || isNaN(minAmountVal) || tx.amount >= minAmountVal;
        const maxMatch = filterMaxAmount === '' || isNaN(maxAmountVal) || tx.amount <= maxAmountVal;
        const amountMatch = minMatch && maxMatch;

        return searchMatch && categoryMatch && startDateMatch && endDateMatch && amountMatch;
    });

    return (
        <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col items-center p-4 sm:p-6 lg:p-8">
            <header className="w-full max-w-6xl mb-8 text-center">
                <h1 className="text-4xl sm:text-5xl font-bold text-slate-900">AI Bank Statement Analyzer</h1>
                <p className="mt-2 text-lg text-slate-600">Upload, categorize, and export your financial transactions with ease.</p>
            </header>

            <main className="w-full max-w-6xl bg-white rounded-xl shadow-lg p-6 sm:p-8">
                {appState === 'upload' && <UploadScreen onFileChange={handleFileChange} />}
                {appState === 'analyzing' && (
                    <AnalysisScreen
                        transactions={filteredTransactions}
                        categories={categories}
                        newCategoryName={newCategoryName}
                        onNewCategoryNameChange={setNewCategoryName}
                        onAddCategory={handleAddCategory}
                        onDeleteCategory={handleDeleteCategory}
                        onTransactionCategoryChange={handleTransactionCategoryChange}
                        onExport={handleExportToCsv}
                        onReset={resetApp}
                        editingCategoryId={editingCategoryId}
                        deletingCategoryId={deletingCategoryId}
                        editingCategoryName={editingCategoryName}
                        onEditingCategoryNameChange={setEditingCategoryName}
                        onStartEditingCategory={handleStartEditingCategory}
                        onSaveCategory={handleSaveCategory}
                        onCancelEditing={handleCancelEditing}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        isStreaming={isStreaming}
                        filterCategory={filterCategory}
                        onFilterCategoryChange={setFilterCategory}
                        filterStartDate={filterStartDate}
                        onFilterStartDateChange={setFilterStartDate}
                        filterEndDate={filterEndDate}
                        onFilterEndDateChange={setFilterEndDate}
                        filterMinAmount={filterMinAmount}
                        onFilterMinAmountChange={setFilterMinAmount}
                        filterMaxAmount={filterMaxAmount}
                        onFilterMaxAmountChange={setFilterMaxAmount}
                        onClearFilters={handleClearFilters}
                        editingNoteId={editingNoteId}
                        editingNoteText={editingNoteText}
                        onEditingNoteTextChange={setEditingNoteText}
                        onStartEditingNote={handleStartEditingNote}
                        onSaveNote={handleSaveNote}
                        onCancelEditingNote={handleCancelEditingNote}
                    />
                )}
                {(appState === 'error') && <ErrorScreen message={errorMessage} onReset={resetApp} />}
            </main>
             <footer className="w-full max-w-6xl mt-8 text-center text-slate-500 text-sm">
                <p>&copy; {new Date().getFullYear()} AI Statement Analyzer. All rights reserved.</p>
            </footer>
        </div>
    );
};


// UI Components
const UploadScreen = ({ onFileChange }: { onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 rounded-lg text-center">
        <UploadIcon className="w-16 h-16 text-indigo-500 mb-4" />
        <h2 className="text-2xl font-semibold text-slate-800 mb-2">Upload your Bank Statement</h2>
        <p className="text-slate-500 mb-6">Drag & drop a PDF file or click to select one.</p>
        <label htmlFor="file-upload" className="cursor-pointer bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
            Select PDF File
        </label>
        <input id="file-upload" type="file" className="hidden" accept=".pdf" onChange={onFileChange} />
    </div>
);

const ErrorScreen = ({ message, onReset }: { message: string, onReset: () => void }) => (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-red-50 border border-red-200 rounded-lg">
        <h2 className="text-2xl font-semibold text-red-700">An Error Occurred</h2>
        <p className="text-red-600 mt-2 mb-6">{message}</p>
        <button onClick={onReset} className="bg-red-600 text-white font-semibold py-2 px-6 rounded-lg shadow-md hover:bg-red-700 transition-colors">
            Try Again
        </button>
    </div>
);

const SummaryCard = ({ title, amount, currency, colorClass }: { title: string; amount: number; currency: string; colorClass: string }) => (
    <div className="bg-white p-4 rounded-lg border shadow-sm">
        <h4 className="text-sm font-medium text-slate-500">{title}</h4>
        <p className={`text-2xl font-bold ${colorClass}`}>
            {amount < 0 && '-'}{currency}{Math.abs(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
    </div>
);

interface AnalysisScreenProps {
    transactions: Transaction[];
    categories: Category[];
    newCategoryName: string;
    onNewCategoryNameChange: (value: string) => void;
    onAddCategory: () => void;
    onDeleteCategory: (id: string) => void;
    onTransactionCategoryChange: (transactionId: string, category: string) => void;
    onExport: () => void;
    onReset: () => void;
    editingCategoryId: string | null;
    deletingCategoryId: string | null;
    editingCategoryName: string;
    onEditingCategoryNameChange: (value: string) => void;
    onStartEditingCategory: (category: Category) => void;
    onSaveCategory: (categoryId: string) => void;
    onCancelEditing: () => void;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    isStreaming: boolean;
    filterCategory: string;
    onFilterCategoryChange: (value: string) => void;
    filterStartDate: string;
    onFilterStartDateChange: (value: string) => void;
    filterEndDate: string;
    onFilterEndDateChange: (value: string) => void;
    filterMinAmount: string;
    onFilterMinAmountChange: (value: string) => void;
    filterMaxAmount: string;
    onFilterMaxAmountChange: (value: string) => void;
    onClearFilters: () => void;
    editingNoteId: string | null;
    editingNoteText: string;
    onEditingNoteTextChange: (value: string) => void;
    onStartEditingNote: (tx: Transaction) => void;
    onSaveNote: (transactionId: string) => void;
    onCancelEditingNote: () => void;
}

const AnalysisScreen: React.FC<AnalysisScreenProps> = ({
    transactions, categories, newCategoryName, onNewCategoryNameChange,
    onAddCategory, onDeleteCategory, onTransactionCategoryChange, onExport, onReset,
    editingCategoryId, deletingCategoryId, editingCategoryName, onEditingCategoryNameChange,
    onStartEditingCategory, onSaveCategory, onCancelEditing,
    searchQuery, onSearchQueryChange, isStreaming,
    filterCategory, onFilterCategoryChange, filterStartDate, onFilterStartDateChange,
    filterEndDate, onFilterEndDateChange, filterMinAmount, onFilterMinAmountChange,
    filterMaxAmount, onFilterMaxAmountChange, onClearFilters,
    editingNoteId, editingNoteText, onEditingNoteTextChange, onStartEditingNote,
    onSaveNote, onCancelEditingNote
}) => {
    
    const summary = useMemo(() => {
        const totalDebits = transactions
            .filter(t => t.type === 'debit')
            // Fix: Explicitly type the accumulator to ensure it's treated as a number.
            .reduce((sum: number, t) => sum + t.amount, 0);

        const totalCredits = transactions
            .filter(t => t.type === 'credit')
            // Fix: Explicitly type the accumulator to ensure it's treated as a number.
            .reduce((sum: number, t) => sum + t.amount, 0);

        const spendingByCategory = transactions
            .filter(t => t.type === 'debit')
            .reduce((acc, t) => {
                const category = t.category || 'Uncategorized';
                acc[category] = (acc[category] || 0) + t.amount;
                return acc;
            }, {} as Record<string, number>);

        const sortedSpending = Object.entries(spendingByCategory)
            // Fix: Use index access for sorting to ensure correct type inference for amounts.
            .sort((a, b) => b[1] - a[1]);
            
        return {
            totalDebits,
            totalCredits,
            netFlow: totalCredits - totalDebits,
            spendingByCategory: sortedSpending,
        };
    }, [transactions]);

    return (
    <div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div className="md:col-span-1 bg-slate-50 p-4 rounded-lg border">
                <h3 className="text-lg font-semibold mb-3">Manage Categories</h3>
                <div className="flex items-center space-x-2 mb-4">
                    <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => onNewCategoryNameChange(e.target.value)}
                        placeholder="New category name"
                        className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        onKeyDown={(e) => e.key === 'Enter' && onAddCategory()}
                    />
                    <button onClick={onAddCategory} className="bg-indigo-500 text-white p-2 rounded-md hover:bg-indigo-600 transition-colors shrink-0">
                        <PlusIcon className="w-5 h-5"/>
                    </button>
                </div>
                <ul className="space-y-2 max-h-60 overflow-y-auto">
                    {categories.map(cat => {
                        const isEditing = editingCategoryId === cat.id;
                        const isDeleting = deletingCategoryId === cat.id;
                        return (
                            <li key={cat.id} className={`flex justify-between items-center bg-white p-2 rounded-md border transition-all duration-300 ${isDeleting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                                {isEditing ? (
                                    <>
                                        <input
                                            type="text"
                                            value={editingCategoryName}
                                            onChange={(e) => onEditingCategoryNameChange(e.target.value)}
                                            className="flex-grow p-1 border border-indigo-300 rounded-md focus:ring-1 focus:ring-indigo-500 text-sm"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') onSaveCategory(cat.id);
                                                if (e.key === 'Escape') onCancelEditing();
                                            }}
                                            autoFocus
                                        />
                                        <div className="flex items-center ml-2 space-x-1">
                                            <button onClick={() => onSaveCategory(cat.id)} className="text-green-500 hover:text-green-700 p-1 rounded-full hover:bg-green-100 transition-colors">
                                                <CheckIcon className="w-5 h-5"/>
                                            </button>
                                            <button onClick={onCancelEditing} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                                                <XIcon className="w-5 h-5"/>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-slate-700 flex-grow">{cat.name}</span>
                                        <div className="flex items-center space-x-2 shrink-0">
                                            <button onClick={() => onStartEditingCategory(cat)} className="text-slate-400 hover:text-indigo-500">
                                                <PencilIcon className="w-4 h-4"/>
                                            </button>
                                            <button onClick={() => onDeleteCategory(cat.id)} className="text-slate-400 hover:text-red-500">
                                                <TrashIcon className="w-4 h-4"/>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </li>
                        )
                    })}
                     {categories.length === 0 && <p className="text-slate-500 text-sm text-center p-4">No categories added yet.</p>}
                </ul>
            </div>
            <div className="md:col-span-2 space-y-8">
                 {transactions.length > 0 && (
                    <div className="bg-slate-50 p-4 rounded-lg border">
                        <h3 className="text-lg font-semibold mb-3">Transaction Summary</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <SummaryCard title="Total Credits" amount={summary.totalCredits} currency="₦" colorClass="text-green-600" />
                            <SummaryCard title="Total Debits" amount={summary.totalDebits} currency="₦" colorClass="text-red-600" />
                            <SummaryCard title="Net Flow" amount={summary.netFlow} currency="₦" colorClass={summary.netFlow >= 0 ? 'text-slate-800' : 'text-red-600'} />
                        </div>
                        <div>
                            <h4 className="text-md font-semibold mb-2">Spending by Category</h4>
                            <div className="bg-white p-4 rounded-lg border shadow-sm max-h-48 overflow-y-auto">
                                {summary.spendingByCategory.length > 0 && summary.totalDebits > 0 ? (
                                    <ul className="space-y-2">
                                        {summary.spendingByCategory.map(([category, amount]) => (
                                            <li key={category} className="flex justify-between items-center text-sm">
                                                <span className="text-slate-700">{category}</span>
                                                <div className="flex items-center space-x-2">
                                                    <span className="font-semibold text-slate-800">₦{amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                                        {((amount / summary.totalDebits) * 100).toFixed(1)}%
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-slate-500 text-sm text-center">No debit transactions to summarize.</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                <div className="flex flex-col items-start space-y-4">
                    <h3 className="text-lg font-semibold">Actions</h3>
                    <div className="flex space-x-4">
                        <button onClick={onExport} className="flex items-center space-x-2 bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition-colors">
                            <DownloadIcon className="w-5 h-5" />
                            <span>Export to CSV</span>
                        </button>
                        <button onClick={onReset} className="flex items-center space-x-2 bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-slate-700 transition-colors">
                            <span>Analyze New Statement</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div className="mb-6 p-4 bg-slate-50 rounded-lg border">
            <h3 className="text-lg font-semibold mb-3">Filter Transactions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <div>
                    <label htmlFor="filter-category" className="block text-sm font-medium text-slate-600 mb-1">Category</label>
                    <select id="filter-category" value={filterCategory} onChange={e => onFilterCategoryChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                        <option value="all">All Categories</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="filter-start-date" className="block text-sm font-medium text-slate-600 mb-1">Start Date</label>
                    <input type="date" id="filter-start-date" value={filterStartDate} onChange={e => onFilterStartDateChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
                </div>
                 <div>
                    <label htmlFor="filter-end-date" className="block text-sm font-medium text-slate-600 mb-1">End Date</label>
                    <input type="date" id="filter-end-date" value={filterEndDate} onChange={e => onFilterEndDateChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Amount</label>
                    <div className="flex items-center space-x-2">
                        <input type="number" placeholder="Min" value={filterMinAmount} onChange={e => onFilterMinAmountChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
                        <input type="number" placeholder="Max" value={filterMaxAmount} onChange={e => onFilterMaxAmountChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
                    </div>
                </div>
            </div>
            <div className="pt-4 border-t border-slate-200 mt-4 flex justify-end">
                <button onClick={onClearFilters} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">Clear All Filters</button>
            </div>
        </div>

        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold">Transactions ({transactions.length})</h3>
            <div className="w-full max-w-xs">
                <input
                    type="text"
                    placeholder="Search by description..."
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>
        </div>
        
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Description</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Notes</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                    {transactions.map(tx => (
                        <tr key={tx.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{tx.date}</td>
                            <td className="px-6 py-4 whitespace-normal text-sm text-slate-800 max-w-xs break-words">{tx.description}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>
                                {tx.type === 'debit' ? '-' : '+'}₦{tx.amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${tx.type === 'debit' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                                </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <select 
                                    value={tx.category} 
                                    onChange={(e) => onTransactionCategoryChange(tx.id, e.target.value)}
                                    className="p-1 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                >
                                    <option>Uncategorized</option>
                                    {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                                </select>
                            </td>
                            <td className="px-6 py-4 whitespace-normal text-sm text-slate-600 min-w-[200px]">
                                {editingNoteId === tx.id ? (
                                    <div className="flex items-start space-x-2">
                                        <textarea
                                            value={editingNoteText}
                                            onChange={(e) => onEditingNoteTextChange(e.target.value)}
                                            className="w-full p-1 border border-indigo-300 rounded-md focus:ring-1 focus:ring-indigo-500 text-sm"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    onSaveNote(tx.id);
                                                }
                                                if (e.key === 'Escape') onCancelEditingNote();
                                            }}
                                            rows={2}
                                            autoFocus
                                        />
                                        <div className="flex flex-col space-y-1">
                                            <button onClick={() => onSaveNote(tx.id)} className="text-green-500 hover:text-green-700 p-1 rounded-full hover:bg-green-100 transition-colors">
                                                <CheckIcon className="w-5 h-5"/>
                                            </button>
                                            <button onClick={onCancelEditingNote} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                                                <XIcon className="w-5 h-5"/>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="group flex items-start justify-between min-h-[38px]">
                                        <p className={`whitespace-pre-wrap ${tx.notes ? 'text-slate-700' : 'italic text-slate-400'}`}>
                                            {tx.notes || 'Add a note...'}
                                        </p>
                                        <button onClick={() => onStartEditingNote(tx)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-500 transition-opacity ml-2 shrink-0">
                                            <PencilIcon className="w-4 h-4"/>
                                        </button>
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                    {isStreaming && (
                         <tr>
                            <td colSpan={6} className="text-center py-8 text-slate-500">
                                <div className="flex items-center justify-center space-x-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                                    <span>Streaming transactions from AI...</span>
                                </div>
                            </td>
                        </tr>
                    )}
                    {transactions.length === 0 && !isStreaming && (
                        <tr>
                            <td colSpan={6} className="text-center py-8 text-slate-500">
                                {searchQuery || filterCategory !== 'all' || filterStartDate || filterEndDate || filterMinAmount || filterMaxAmount 
                                ? 'No transactions match your filters.' 
                                : 'No transactions were found in the document.'}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
)};

export default App;