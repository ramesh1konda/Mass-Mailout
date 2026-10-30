// AIT-TBC | CampaignSteps.tsx | Ramesh Konda | 2026-10-28 | Campaign builder step indicator (info, recipients, content, attachments, review)
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

import React from 'react';
import { Step } from '../types';

interface CampaignStepsProps {
  currentStep: Step;
}

const steps: { key: Step; label: string; icon: string }[] = [
  { key: 'info', label: 'Basic Info', icon: 'fa-info-circle' },
  { key: 'recipients', label: 'Recipients', icon: 'fa-users' },
  { key: 'content', label: 'Template', icon: 'fa-envelope-open-text' },
  { key: 'attachments', label: 'Attachments', icon: 'fa-paperclip' },
  { key: 'review', label: 'Review', icon: 'fa-check-double' },
];

const CampaignSteps: React.FC<CampaignStepsProps> = ({ currentStep }) => {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="w-full mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index <= currentIndex;
          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center flex-1">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    isActive ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-400'
                  }`}
                >
                  <i className={`fas ${step.icon}`}></i>
                </div>
                <span className={`mt-2 text-xs font-medium ${isActive ? 'text-blue-600' : 'text-slate-400'}`}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mt-5 transition-all duration-300 ${index < currentIndex ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default CampaignSteps;
