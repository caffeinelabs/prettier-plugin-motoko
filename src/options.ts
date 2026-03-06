import { SupportOption } from 'prettier';

const options: Record<string, SupportOption> = {
    motokoRemoveLinesAroundCodeBlocks: {
        category: 'motoko',
        type: 'boolean',
        default: false,
        description: 'Remove extra lines around code blocks',
    },
    motokoOrganizeImports: {
        category: 'motoko',
        type: 'boolean',
        default: false,
        description:
            'Organize and sort import statements (groups by prefix: ic:, canister:, mo:, and relative paths)',
    },
};

export default options;
