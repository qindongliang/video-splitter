import React from 'react';

interface DurationInputProps {
    value: number;
    onChange: (value: number) => void;
    unit: 'seconds' | 'minutes';
    onUnitChange: (unit: 'seconds' | 'minutes') => void;
    disabled?: boolean;
}

const PRESETS = [
    { label: '30秒', value: 30, unit: 'seconds' as const },
    { label: '1分钟', value: 60, unit: 'seconds' as const },
    { label: '5分钟', value: 300, unit: 'seconds' as const },
    { label: '10分钟', value: 600, unit: 'seconds' as const },
    { label: '30分钟', value: 1800, unit: 'seconds' as const },
];

const DurationInput: React.FC<DurationInputProps> = ({
    value,
    onChange,
    unit,
    onUnitChange,
    disabled = false,
}) => {
    const displayValue = unit === 'minutes' ? Math.floor(value / 60) : value;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = parseInt(e.target.value) || 0;
        const seconds = unit === 'minutes' ? inputValue * 60 : inputValue;
        onChange(Math.max(1, seconds));
    };

    const handlePresetClick = (presetValue: number) => {
        if (disabled) return;
        onChange(presetValue);
        onUnitChange('seconds');
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24">
                    ⏱️ 每段时长
                </label>
                <div className="flex items-center space-x-2">
                    <input
                        type="number"
                        min={1}
                        value={displayValue}
                        onChange={handleInputChange}
                        disabled={disabled}
                        className={`
              w-24 px-3 py-2 rounded-lg 
              bg-white dark:bg-slate-800 
              border border-slate-300 dark:border-slate-600
              text-slate-900 dark:text-white text-center font-medium
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
              transition-all duration-200
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
                    />
                    <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                        <button
                            onClick={() => onUnitChange('seconds')}
                            disabled={disabled}
                            className={`
                px-3 py-2 text-sm font-medium transition-all duration-200
                ${unit === 'seconds'
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
                        >
                            秒
                        </button>
                        <button
                            onClick={() => onUnitChange('minutes')}
                            disabled={disabled}
                            className={`
                px-3 py-2 text-sm font-medium transition-all duration-200
                ${unit === 'minutes'
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
                        >
                            分钟
                        </button>
                    </div>
                </div>
            </div>

            {/* Presets */}
            <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-500 dark:text-slate-500 w-24">快捷选择:</span>
                <div className="flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            onClick={() => handlePresetClick(preset.value)}
                            disabled={disabled}
                            className={`
                px-3 py-1.5 text-xs font-medium rounded-full
                transition-all duration-200
                ${value === preset.value
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DurationInput;
