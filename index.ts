import { existsSync, promises as fs } from 'fs';
import { isUndefined, map, uniqBy } from 'lodash';
import * as path from 'path';
import { Node, Project as TsProject } from 'ts-morph';

const basePath = path.resolve('../ngxp-demo/');

run();

async function run() {
    const tsProject = new TsProject({
        tsConfigFilePath: path.join(basePath, 'tsconfig.json')
    });

    const workspace = await readWorkspace(path.join(basePath, 'angular.json'));

    getProjects(workspace)
        .map(getTsConfigPath)
        .filter(tsConfigPath => existsSync(tsConfigPath))
        .forEach(tsConfigPath => tsProject.addSourceFilesFromTsConfig(tsConfigPath));

    const references = getLibraryBarrelFilePaths(workspace)
        .map(barrelFilePath => tsProject.getSourceFile(barrelFilePath)!)
        .filter(file => !isUndefined(file))
        .flatMap(file => file.getExportSymbols().map(symbol => ({
            file,
            symbol,
            referencingSourceFiles: symbol.getDeclarations().flatMap(declaration => {
                if (!Node.isReferenceFindableNode(declaration)) {
                    return [];
                }

                return declaration.findReferencesAsNodes()
                    .map(node => node.getSourceFile())
            })
        })));

    const data = {
        nodes: [] as any[],
        links: [] as any[]
    };

    const blacklist = ['common', 'resource'];

    references.forEach(({ file, referencingSourceFiles }) => {
        const source = getProjectName(workspace, file!.getFilePath());
        const sourceId = `source-${source}`;

        // if (blacklist.includes(source)) { return }

        data.nodes.push({
            id: sourceId,
            title: source
        });

        referencingSourceFiles.forEach(referencingFile => {
            const target = getProjectName(workspace, referencingFile.getSourceFile().getFilePath());
            const targetId = `target-${target}`;

            // if (blacklist.includes(target)) { return }

            if (target === source) {
                return;
            }

            data.nodes.push({
                id: targetId,
                title: target
            });

            let link = data.links.find(link => link.source === sourceId && link.target === targetId);

            if (isUndefined(link)) {
                link = {
                    source: sourceId,
                    target: targetId,
                    value: 0
                };
                data.links.push(link);
            }

            link.value = link.value + 1;
        });
    });

    data.nodes = uniqBy(data.nodes, 'id');

    await fs.writeFile('data.json', JSON.stringify(data, undefined, 4));
}

interface Workspace {
    projects: {
        [key: string]: ProjectDeclaration
    }
}

interface ProjectDeclaration {
    root: string;
    sourceRoot: string;
    projectType: ProjectType;
}

interface Project extends ProjectDeclaration {
    name: string;
}

enum ProjectType {
    Application = 'application',
    Library = 'library'
}

async function readWorkspace(path: string): Promise<Workspace> {
    return JSON.parse(await fs.readFile(path, 'utf-8'));
}

function getProjectName(workspace: Workspace, filePath: string) {
    const matchingProject = getProjects(workspace)
        .find(project => toRelativePath(filePath).startsWith(project.sourceRoot))

    if (isUndefined(matchingProject)) {
        throw Error(`Cannot find library for file ${filePath}.`)
    }

    return matchingProject.name;
}

function getLibraryBarrelFilePaths(workspace: Workspace) {
    return getLibraries(workspace)
        .map(library => path.join(basePath, library.sourceRoot, 'index.ts'));
}

function getLibraries(workspace: Workspace): Project[] {
    return getProjects(workspace)
        .filter(project => project.projectType === ProjectType.Library)
}

function getProjects(workspace: Workspace): Project[] {
    return map(workspace.projects, (project, name) => ({
        name,
        ...project
    }))
}

function getTsConfigPath({ projectType, root }: Project) {
    const fileNameMapping = {
        [ProjectType.Application]: 'tsconfig.app.json',
        [ProjectType.Library]: 'tsconfig.lib.json'
    }

    return path.join(basePath, root, fileNameMapping[projectType])
}

function toRelativePath(filePath: string) {
    return path.relative(basePath, filePath).replace(/\\/g, '/');
}
