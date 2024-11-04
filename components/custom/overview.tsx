import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

import { JPalLogo, MessageIcon, VercelIcon } from './icons';

export const Overview = () => {
  return (
    <motion.div
      key="overview"
      className="max-w-3xl mx-auto md:mt-20"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: 0.5 }}
    >
      <div className="rounded-xl p-6 flex flex-col gap-8 leading-relaxed text-center max-w-xl">
        <p className="flex flex-row justify-center gap-4 items-center">
          {/* <VercelIcon size={32} />
          <span>+</span>
          <MessageIcon size={100} /> */}
          <Image
            src="/images/CJ_LOGO_ENGLISH_RED_SVG copy.svg"
            alt={'J-Pal logo'}
            width={300}
            height={300}
          />
        </p>
        <p className='text-left'>
          Jameel-CLIO is a chatbot focused on research supported by Community
          Jameel.<br />
       
          The chatbot utilises OpenAI&lsquo;s ChatGPT-4o mini and adds a
          contextual corpus of hundreds of research papers.<br />
       
          Jameel-CLIO 1.0 engages research from the Abdul Latif Jameel Poverty
          Action Lab (J-PAL).
        </p>
      </div>
    </motion.div>
  );
};
