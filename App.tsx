import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Transaction, Category, Session } from './types';
import { UploadIcon, TrashIcon, DownloadIcon, PlusIcon, PencilIcon, CheckIcon, XIcon, SparklesIcon, ArrowUpDownIcon, SaveIcon } from './components/icons';

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

// Creates a consistent, unique key for a transaction to persist its note
const createTransactionKey = (tx: { date: string, description: string, amount: number, type: 'debit' | 'credit' }): string => {
    const normalizedDescription = tx.description.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    return `tx_note::${tx.date}_${normalizedDescription}_${tx.amount}_${tx.type}`;
};


type AppState = 'init' | 'upload' | 'analyzing' | 'error';
type SortDirection = 'asc' | 'desc';
type SortKey = keyof Transaction | null;


const NoteEditModal = ({ transaction, onSave, onClose }: { transaction: Transaction | null, onSave: (txId: string, note: string) => void, onClose: () => void }) => {
    const [noteText, setNoteText] = useState('');
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (transaction) {
            setNoteText(transaction.notes || '');
            setTimeout(() => textAreaRef.current?.focus(), 100);
        }
    }, [transaction]);
    
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    if (!transaction) return null;

    const handleSave = () => {
        onSave(transaction.id, noteText);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity duration-300" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">Edit Note</h3>
                    <p className="text-sm text-slate-500 mb-4 break-words" title={transaction.description}>
                        For: <span className="font-medium text-slate-700">{transaction.description}</span>
                    </p>
                    <textarea
                        ref={textAreaRef}
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base"
                        rows={6}
                        placeholder="Add your note here..."
                    />
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={handleSave} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save Note</button>
                </div>
            </div>
            <style>{`
                @keyframes fade-in-scale {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                .animate-fade-in-scale {
                    animation: fade-in-scale 0.2s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

const SaveSessionModal = ({ onSave, onClose }: { onSave: (name: string) => void, onClose: () => void }) => {
    const [name, setName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100);
    }, []);

    const handleSave = () => {
        if (name.trim()) {
            onSave(name.trim());
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4">Save Session</h3>
                    <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyUp={(e) => e.key === 'Enter' && handleSave()}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base"
                        placeholder="e.g., Q1 2024 Statement"
                    />
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={handleSave} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save</button>
                </div>
            </div>
             <style>{`
                @keyframes fade-in-scale {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                .animate-fade-in-scale {
                    animation: fade-in-scale 0.2s ease-out forwards;
                }
            `}</style>
        </div>
    );
};


const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>('init');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [categories, setCategories] = useState<Category[]>(() => {
        const defaultCategories = [
            { id: '1', name: 'Groceries' }, { id: '2', name: 'Utilities' }, { id: '3', name: 'Rent' },
            { id: '4', name: 'Entertainment' }, { id: '5', name: 'Transport' }, { id: '6', name: 'Health' },
            { id: '7', name: 'Dining Out' }, { id: '8', name: 'Uncategorized' }
        ];
        try {
            const savedCategories = localStorage.getItem('bankAnalyzerCategories');
            if (savedCategories) {
                const parsed = JSON.parse(savedCategories);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (error) { console.error("Could not load categories from local storage", error); }
        return defaultCategories;
    });
    const [newCategoryName, setNewCategoryName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [suggestingForTxId, setSuggestingForTxId] = useState<string | null>(null);
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [editingTransactionForNote, setEditingTransactionForNote] = useState<Transaction | null>(null);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterType, setFilterType] = useState<'all' | 'debit' | 'credit'>('all');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [amountRange, setAmountRange] = useState({ min: '', max: '' });
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' });

    // Load sessions from local storage on initial mount
    useEffect(() => {
        try {
            const savedSessions = localStorage.getItem('bankAnalyzerSessions');
            if (savedSessions) {
                setSessions(JSON.parse(savedSessions));
            }
        } catch (error) {
            console.error("Could not load sessions from local storage", error);
            localStorage.removeItem('bankAnalyzerSessions');
        }
        setAppState('upload');
    }, []);

    // Save sessions to local storage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('bankAnalyzerSessions', JSON.stringify(sessions));
        } catch (error) {
            console.error("Could not save sessions to local storage", error);
        }
    }, [sessions]);


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
        if (!file) return;

        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            setErrorMessage('Please upload a valid PDF file.');
            event.target.value = '';
            return;
        }

        setAppState('analyzing');
        setTransactions([]);
        setErrorMessage('');
        setIsStreaming(true);
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const pdfPart = await fileToGenerativePart(file);
            const prompt = `You are an expert data extraction AI. Your task is to analyze the provided PDF bank statement and extract every transaction. Process the entire document. For each transaction, output a single, minified JSON object on its own line. Do not include any other text, explanations, or markdown. Each JSON object must contain: "date" (string, "YYYY-MM-DD"), "description" (string), "amount" (number), and "type" (string, either "debit" or "credit"). All amounts are in Nigerian Naira (NGN).`;

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
                
                const newTxs: Transaction[] = lines.flatMap(line => {
                    if (!line.trim()) return [];
                    try {
                        const txData = JSON.parse(line);
                        if (txData.date && txData.description && typeof txData.amount === 'number' && txData.type) {
                            const noteKey = createTransactionKey(txData);
                            const savedNote = localStorage.getItem(noteKey);
                            return [{
                                ...txData,
                                id: `${Date.now()}-${transactionCount++}`,
                                category: 'Uncategorized',
                                notes: savedNote ?? undefined,
                            }];
                        }
                    } catch (e) { console.warn("Could not parse JSON line:", line); }
                    return [];
                });
                if (newTxs.length > 0) setTransactions(prev => [...prev, ...newTxs]);
            }
        } catch (error) {
            console.error("Error processing statement:", error);
            setErrorMessage(`Failed to analyze statement. ${error instanceof Error ? error.message : 'Unknown error.'}`);
            setAppState('error');
        } finally {
            setIsStreaming(false);
            event.target.value = '';
        }
    };
    
    const handleAddCategory = () => {
        if (newCategoryName.trim() && !categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase())) {
            setCategories([...categories, { id: Date.now().toString(), name: newCategoryName.trim() }]);
            setNewCategoryName('');
        }
    };

    const handleDeleteCategory = (id: string) => {
        setTransactions(txs => txs.map(tx => tx.category === categories.find(c => c.id === id)?.name ? { ...tx, category: 'Uncategorized' } : tx));
        setCategories(cats => cats.filter(c => c.id !== id));
    };

    const handleSaveCategory = (id: string) => {
        setCategories(cats => cats.map(c => c.id === id ? { ...c, name: editingCategoryName } : c));
        setEditingCategoryId(null);
    };
    
    const handleUpdateTransactionCategory = (id: string, category: string) => {
        setTransactions(txs => txs.map(tx => tx.id === id ? { ...tx, category } : tx));
    };
    
    const handleSaveNote = (txId: string, note: string) => {
        const transaction = transactions.find(tx => tx.id === txId);
        if (transaction) {
            const noteKey = createTransactionKey(transaction);
            if (note) {
                localStorage.setItem(noteKey, note);
            } else {
                localStorage.removeItem(noteKey);
            }
            setTransactions(txs => txs.map(tx => tx.id === txId ? { ...tx, notes: note || undefined } : tx));
        }
        setEditingTransactionForNote(null);
    };

    const handleSuggestCategory = async (txId: string) => {
        const transaction = transactions.find(t => t.id === txId);
        if (!transaction || categories.length === 0) return;
        setSuggestingForTxId(txId);
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not set.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const categoryNames = categories.map(c => c.name).join(', ');
            const prompt = `Given the transaction description "${transaction.description}" and available categories [${categoryNames}], what is the most suitable category? Respond with only the category name. If none fit, respond "Uncategorized".`;
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            const suggestedCategory = response.text.trim();
            if (categories.some(c => c.name === suggestedCategory)) {
                handleUpdateTransactionCategory(txId, suggestedCategory);
            }
        } catch (error) {
            console.error("Error suggesting category:", error);
        } finally {
            setSuggestingForTxId(null);
        }
    };

    const handleExportCSV = () => {
        setIsExporting(true);
        const headers = ["ID", "Date", "Description", "Amount", "Type", "Category", "Notes"];
        const rows = filteredAndSortedTransactions.map(tx => [
            tx.id, tx.date, `"${tx.description.replace(/"/g, '""')}"`, 
            tx.amount, tx.type, tx.category, `"${tx.notes?.replace(/"/g, '""') ?? ''}"`
        ].join(','));
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "transactions.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => setIsExporting(false), 1000);
    };
    
    const handleReset = () => {
        setAppState('upload');
        setTransactions([]);
        setErrorMessage('');
    };

    const handleSaveSession = (name: string) => {
        const newSession: Session = {
            id: Date.now().toString(),
            name,
            timestamp: Date.now(),
            transactions,
            categories,
        };
        setSessions(prev => [...prev.filter(s => s.name.toLowerCase() !== name.toLowerCase()), newSession].sort((a,b) => b.timestamp - a.timestamp));
        setIsSaveModalOpen(false);
    };
    
    const handleLoadSession = (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setTransactions(session.transactions);
            setCategories(session.categories);
            setAppState('analyzing');
        }
    };

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Are you sure you want to delete this session?")) {
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    };
    
    const requestSort = (key: SortKey) => {
        if (!key) return;
        let direction: SortDirection = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredAndSortedTransactions = useMemo(() => {
        let filtered = transactions.filter(tx => {
            const searchLower = searchQuery.toLowerCase();
            const txDate = new Date(tx.date);

            const startDate = dateRange.start ? new Date(dateRange.start) : null;
            if (startDate) startDate.setHours(0, 0, 0, 0);
            const endDate = dateRange.end ? new Date(dateRange.end) : null;
            if (endDate) endDate.setHours(23, 59, 59, 999);
            if (startDate && txDate < startDate) return false;
            if (endDate && txDate > endDate) return false;

            const minAmount = amountRange.min !== '' ? parseFloat(amountRange.min) : -Infinity;
            const maxAmount = amountRange.max !== '' ? parseFloat(amountRange.max) : Infinity;
            if (tx.amount < minAmount || tx.amount > maxAmount) return false;

            return (
                (tx.description.toLowerCase().includes(searchLower) || tx.notes?.toLowerCase().includes(searchLower)) &&
                (filterCategory === 'all' || tx.category === filterCategory) &&
                (filterType === 'all' || tx.type === filterType)
            );
        });

        if (sortConfig.key) {
            const key = sortConfig.key;
            filtered.sort((a, b) => {
                const valA = a[key] ?? '';
                const valB = b[key] ?? '';
                let comparison = 0;
                if (key === 'amount') comparison = (valA as number) - (valB as number);
                else if (key === 'date') comparison = new Date(valA as string).getTime() - new Date(valB as string).getTime();
                else comparison = String(valA).toLowerCase().localeCompare(String(valB).toLowerCase());
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return filtered;
    }, [transactions, searchQuery, filterCategory, filterType, dateRange, amountRange, sortConfig]);

    const summary = useMemo(() => {
        const totalDebits = filteredAndSortedTransactions.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
        const totalCredits = filteredAndSortedTransactions.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
        return { totalDebits, totalCredits, netFlow: totalCredits - totalDebits };
    }, [filteredAndSortedTransactions]);
    
    const currencyFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

    const SortableHeader = ({ label, sortKey }: { label: string, sortKey: keyof Transaction }) => (
        <th className="px-4 py-3 cursor-pointer select-none group" onClick={() => requestSort(sortKey)}>
            <div className="flex items-center">
                <span>{label}</span>
                <ArrowUpDownIcon className={`w-4 h-4 ml-1.5 transition-opacity ${sortConfig.key === sortKey ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'}`}
                    direction={sortConfig.key === sortKey ? sortConfig.direction : 'none'}
                />
            </div>
        </th>
    );


    if (appState === 'init') return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="w-16 h-16 border-4 border-indigo-500 border-dashed rounded-full animate-spin"></div></div>;

    if (appState === 'upload' || appState === 'error') {
        return (
            <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-slate-800">AI Bank Statement Analyzer</h1>
                    <p className="text-slate-600 mt-2">Upload a PDF to instantly extract and categorize your transactions.</p>
                </div>
                <div className="w-full max-w-2xl">
                    <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-lg border-2 border-dashed border-slate-300 hover:border-indigo-500 transition-all p-10 flex flex-col items-center justify-center text-center">
                        <UploadIcon className="w-12 h-12 text-slate-400 mb-4" />
                        <span className="text-lg font-semibold text-slate-700">Click to upload a bank statement</span>
                        <p className="text-sm text-slate-500 mt-1">or drag and drop (PDF only)</p>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pdf,application/pdf" />
                    </label>
                    {appState === 'error' && (
                        <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                            <strong className="font-bold">Error:</strong>
                            <span className="block sm:inline ml-2">{errorMessage}</span>
                        </div>
                    )}
                     {sessions.length > 0 && (
                        <div className="mt-8 bg-white p-6 rounded-xl shadow-md">
                            <h2 className="text-xl font-semibold text-slate-700 mb-4">Saved Sessions</h2>
                            <ul className="space-y-3">
                                {sessions.map(session => (
                                    <li key={session.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                        <div>
                                            <p className="font-semibold text-slate-800">{session.name}</p>
                                            <p className="text-sm text-slate-500">Saved on: {new Date(session.timestamp).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleLoadSession(session.id)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">Load</button>
                                            <button onClick={() => handleDeleteSession(session.id)} className="p-2 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    
    return (
        <>
            <NoteEditModal transaction={editingTransactionForNote} onSave={handleSaveNote} onClose={() => setEditingTransactionForNote(null)} />
            {isSaveModalOpen && <SaveSessionModal onSave={handleSaveSession} onClose={() => setIsSaveModalOpen(false)} />}
        
            <div className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8">
                <div className="max-w-screen-2xl mx-auto">
                    <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-800">Transaction Analysis</h1>
                            <p className="text-slate-500 mt-1">Review, categorize, and export your financial data.</p>
                        </div>
                        <div className="flex items-center gap-4">
                             <button onClick={() => setIsSaveModalOpen(true)} className="bg-white text-indigo-600 border border-indigo-600 font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-indigo-50 transition-colors flex items-center gap-2">
                                <SaveIcon className="w-5 h-5" />
                                <span>Save Session</span>
                            </button>
                            <button onClick={handleReset} className="bg-rose-500 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-rose-600 transition-colors flex items-center gap-2">
                                <TrashIcon className="w-5 h-5" />
                                <span>Upload New Statement</span>
                            </button>
                        </div>
                    </header>
                    
                    <div className="bg-white p-6 rounded-xl shadow-md mb-6">
                        <h2 className="text-xl font-semibold text-slate-700 mb-4">Manage Categories</h2>
                        <div className="flex flex-wrap items-start gap-4">
                            <div className="flex-grow flex flex-wrap gap-2">
                                {categories.map(cat => (
                                    <div key={cat.id} className="flex items-center bg-slate-100 rounded-full pl-4 text-sm font-medium text-slate-700">
                                        {editingCategoryId === cat.id ? (
                                            <>
                                                <input type="text" value={editingCategoryName} onChange={e => setEditingCategoryName(e.target.value)} onKeyUp={e => e.key === 'Enter' && handleSaveCategory(cat.id)} autoFocus className="bg-transparent focus:outline-none py-1" />
                                                <button onClick={() => handleSaveCategory(cat.id)} className="p-2 text-slate-500 hover:text-green-600"><CheckIcon className="w-4 h-4" /></button>
                                                <button onClick={() => setEditingCategoryId(null)} className="p-2 text-slate-500 hover:text-red-600"><XIcon className="w-4 h-4" /></button>
                                            </>
                                        ) : (
                                            <>
                                                <span>{cat.name}</span>
                                                <button onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }} className="p-2 text-slate-400 hover:text-indigo-600"><PencilIcon className="w-4 h-4" /></button>
                                                {cat.name !== 'Uncategorized' && <button onClick={() => handleDeleteCategory(cat.id)} className="p-2 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyUp={e => e.key === 'Enter' && handleAddCategory()} placeholder="New category name" className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
                                <button onClick={handleAddCategory} className="bg-indigo-600 text-white p-2 rounded-md shadow-sm hover:bg-indigo-700 transition-colors"><PlusIcon className="w-5 h-5" /></button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                        <div className="bg-white p-6 rounded-xl shadow-md lg:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                                <h2 className="text-xl font-semibold text-slate-700">Filters</h2>
                                <button onClick={handleExportCSV} disabled={isExporting} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-green-700 transition-colors flex items-center gap-2 disabled:bg-slate-400">
                                    {isExporting ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <DownloadIcon className="w-5 h-5" />}
                                    <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <input type="text" placeholder="Search description..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full" />
                                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full">
                                    <option value="all">All Categories</option>
                                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                                <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full">
                                    <option value="all">All Types</option>
                                    <option value="debit">Debit</option>
                                    <option value="credit">Credit</option>
                                </select>
                                <div className="flex items-center gap-2">
                                    <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full" title="Start Date" />
                                    <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full" title="End Date" />
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="number" placeholder="Min amount" value={amountRange.min} onChange={e => setAmountRange(prev => ({ ...prev, min: e.target.value }))} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full" />
                                    <input type="number" placeholder="Max amount" value={amountRange.max} onChange={e => setAmountRange(prev => ({ ...prev, max: e.target.value }))} className="border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm w-full" />
                                </div>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <h2 className="text-xl font-semibold text-slate-700 mb-4">Summary</h2>
                            <div className="space-y-3">
                                <div className="flex justify-between items-baseline"><span className="text-slate-500">Total Outgoing (Debits)</span><span className="font-semibold text-red-500 text-lg">{currencyFormatter.format(summary.totalDebits)}</span></div>
                                <div className="flex justify-between items-baseline"><span className="text-slate-500">Total Incoming (Credits)</span><span className="font-semibold text-green-500 text-lg">{currencyFormatter.format(summary.totalCredits)}</span></div>
                                <hr className="my-2 border-slate-200" />
                                <div className="flex justify-between items-baseline"><span className="font-bold text-slate-600">Net Flow</span><span className={`font-bold text-xl ${summary.netFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currencyFormatter.format(summary.netFlow)}</span></div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-md overflow-x-auto">
                        {isStreaming && <div className="p-4 text-center text-slate-600 font-semibold flex items-center justify-center gap-2"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>Analyzing your statement...</div>}
                        <table className="w-full text-sm text-left text-slate-500">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-100">
                                <tr>
                                    <SortableHeader label="Date" sortKey="date" />
                                    <SortableHeader label="Description" sortKey="description" />
                                    <SortableHeader label="Amount" sortKey="amount" />
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3 w-1/4">Category</th>
                                    <th className="px-4 py-3">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAndSortedTransactions.map(tx => (
                                    <tr key={tx.id} className="bg-white border-b hover:bg-slate-50">
                                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{tx.date}</td>
                                        <td className="px-4 py-3 max-w-sm truncate" title={tx.description}>{tx.description}</td>
                                        <td className={`px-4 py-3 font-semibold whitespace-nowrap ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>{currencyFormatter.format(tx.amount)}</td>
                                        <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${tx.type === 'debit' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{tx.type}</span></td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1">
                                                <select value={tx.category} onChange={e => handleUpdateTransactionCategory(tx.id, e.target.value)} className="w-full border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                                                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                </select>
                                                <button onClick={() => handleSuggestCategory(tx.id)} disabled={suggestingForTxId === tx.id} className="p-1.5 text-slate-500 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-wait">
                                                    {suggestingForTxId === tx.id ? <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div> : <SparklesIcon className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <button onClick={() => setEditingTransactionForNote(tx)} className={`px-2 py-1 rounded ${tx.notes ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                                                {tx.notes ? 'View/Edit' : 'Add Note'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {transactions.length > 0 && filteredAndSortedTransactions.length === 0 && <p className="p-4 text-center text-slate-500">No transactions match your current filters.</p>}
                        {transactions.length === 0 && !isStreaming && <p className="p-4 text-center text-slate-500">No transactions found in the uploaded statement.</p>}
                    </div>
                </div>
            </div>
        </>
    );
};

export default App;
